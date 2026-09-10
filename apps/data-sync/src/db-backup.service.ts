import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { S3Service } from '@htownautos/common';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Prefijo en el bucket privado. */
const PREFIX = 'db-backups/';
/** Dias de copias que se conservan. */
const KEEP_DAYS = 7;

/**
 * Volcado diario de Postgres a Backblaze B2.
 *
 * Es lo unico que separa "se rompio el servidor" de "perdi el negocio": la base
 * vive en un solo host junto a Coolify, RabbitMQ y OpenSearch, y hasta ahora no
 * habia ninguna copia en ningun sitio.
 *
 * Va al bucket **privado**, que es el perfil por defecto de `S3Service`. Un
 * volcado de la base entera en el bucket publico seria peor que no tener copia.
 *
 * El volcado se escribe a disco y se sube por streaming: son cientos de MB y
 * meterlos en un Buffer se lleva por delante el contenedor.
 */
@Injectable()
export class DbBackupService {
  private readonly logger = new Logger(DbBackupService.name);
  private running = false;

  constructor(private readonly s3: S3Service) {}

  /** 03:30 Houston: fuera de subastas y despues de la purga de frames. */
  @Cron('30 3 * * *', { timeZone: 'America/Chicago' })
  async daily(): Promise<void> {
    await this.run().catch((e) => this.logger.error(`[Backup] ${e.message}`));
  }

  async run(): Promise<{ key: string; bytes: number } | null> {
    if (this.running) {
      this.logger.warn('[Backup] Ya hay uno en curso, se salta esta pasada');
      return null;
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.logger.error('[Backup] DATABASE_URL no configurada');
      return null;
    }

    this.running = true;
    const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const tmp = join(tmpdir(), `htownautos-${sello}.sql.gz`);
    const inicio = Date.now();

    try {
      await this.dump(url, tmp);
      const { size } = await fs.stat(tmp);
      if (size < 1024) throw new Error(`Volcado sospechosamente pequeño (${size} B)`);

      const key = `${PREFIX}${sello}.sql.gz`;
      await this.s3.uploadStreamToKey(createReadStream(tmp), key, size, 'application/gzip');

      const segundos = Math.round((Date.now() - inicio) / 1000);
      this.logger.log(
        `[Backup] ${key} — ${(size / 1e9).toFixed(2)} GB en ${segundos}s`,
      );

      await this.purge();
      return { key, bytes: size };
    } finally {
      // El temporal se borra pase lo que pase: si no, el disco del host se
      // llena en una semana con volcados fallidos.
      await fs.unlink(tmp).catch(() => undefined);
      this.running = false;
    }
  }

  /**
   * `pg_dump | gzip` a fichero.
   *
   * `--no-owner --no-privileges` para que restaure en cualquier servidor sin
   * pelearse con roles que alli no existen — que es justo el caso de una
   * recuperacion de desastre en una maquina nueva.
   */
  private dump(url: string, destino: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pg = spawn(
        'pg_dump',
        ['--no-owner', '--no-privileges', '--format=plain', '--dbname', url],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const gz = spawn('gzip', ['-6'], { stdio: ['pipe', 'pipe', 'inherit'] });
      const salida = createWriteStream(destino);

      let err = '';
      pg.stderr.on('data', (d) => {
        err += String(d);
      });

      pg.stdout.pipe(gz.stdin);
      gz.stdout.pipe(salida);

      pg.on('error', (e) =>
        reject(
          new Error(
            `No se pudo ejecutar pg_dump (${e.message}). ` +
              '¿Esta postgresql-client en la imagen?',
          ),
        ),
      );
      pg.on('close', (code) => {
        if (code !== 0) reject(new Error(`pg_dump salio con ${code}: ${err.slice(0, 300)}`));
      });
      salida.on('finish', resolve);
      salida.on('error', reject);
    });
  }

  /** Borra las copias mas viejas que {@link KEEP_DAYS}. */
  private async purge(): Promise<number> {
    const corte = Date.now() - KEEP_DAYS * 86_400_000;
    const objetos = await this.s3.listPrefix(PREFIX);
    const viejos = objetos.filter((o) => o.modified.getTime() < corte);

    // Nunca dejar el prefijo vacio: si algo va mal con las fechas, es preferible
    // conservar copias de mas a quedarse sin ninguna.
    if (!viejos.length || viejos.length >= objetos.length) return 0;

    const n = await this.s3.deleteKeys(viejos.map((o) => o.key));
    this.logger.log(`[Backup] ${n} copia(s) de mas de ${KEEP_DAYS} dias borradas`);
    return n;
  }
}
