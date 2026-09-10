import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from '@htownautos/common';
import { spawn } from 'node:child_process';

const PREFIX = 'db-backups/env/';

/**
 * Variables del sistema que inyecta el contenedor y no son configuracion de la
 * aplicacion. Se excluyen para que el fichero sea legible al restaurar.
 */
const RUIDO = /^(PATH|HOME|HOSTNAME|PWD|SHLVL|TERM|LANG|LC_|NODE_VERSION|YARN_|npm_|_$)/;

/**
 * Copia cifrada de la configuracion, junto al volcado de la base.
 *
 * Sin esto, una copia de la base no basta para volver a levantar nada: las
 * variables viven en Coolify y Coolify corre en el mismo host que se supone que
 * ha muerto. Codigo en GitHub + base en B2 + configuracion en B2 es lo que hace
 * que "se rompio el servidor" sea una tarde de trabajo.
 *
 * El proceso lee **su propio entorno**: no hace falta el token de Coolify ni
 * hablar con su API, porque estas variables son exactamente las que Coolify le
 * inyecto al arrancar.
 *
 * Se cifra siempre. Un volcado de configuracion en claro incluye las claves de
 * B2 — es decir, las llaves del sitio donde esta guardado — y las de Stripe,
 * Clerk y Twilio. Si no hay `BACKUP_PASSPHRASE` no se escribe nada: es
 * preferible no tener copia a tener una que agrave el problema.
 *
 * Formato compatible con el `openssl` de cualquier maquina, a proposito: en una
 * recuperacion de desastre no quieres depender de tener este repo para poder
 * leer tu propia configuracion.
 *
 *   openssl enc -d -aes-256-cbc -pbkdf2 -in envs.json.enc -out envs.json
 */
@Injectable()
export class EnvBackupService {
  private readonly logger = new Logger(EnvBackupService.name);

  constructor(private readonly s3: S3Service) {}

  async run(): Promise<{ key: string; vars: number } | null> {
    const passphrase = process.env.BACKUP_PASSPHRASE;
    if (!passphrase) {
      this.logger.warn(
        '[EnvBackup] Sin BACKUP_PASSPHRASE no se guarda la configuracion. ' +
          'Ponla en Coolify y apuntala FUERA del sistema: sin ella la copia no se puede descifrar.',
      );
      return null;
    }

    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!RUIDO.test(k) && v !== undefined) vars[k] = v;
    }

    const contenido = JSON.stringify(
      { exportadoEl: new Date().toISOString(), total: Object.keys(vars).length, vars },
      null,
      2,
    );

    const cifrado = await this.encrypt(contenido, passphrase);
    const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const key = `${PREFIX}${sello}.json.enc`;

    await this.s3.uploadBufferToKey(cifrado, key, 'application/octet-stream');
    this.logger.log(`[EnvBackup] ${key} — ${Object.keys(vars).length} variables cifradas`);

    await this.purge();
    return { key, vars: Object.keys(vars).length };
  }

  /** `openssl enc -aes-256-cbc -pbkdf2`, para poder descifrarlo sin este repo. */
  private encrypt(texto: string, passphrase: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const p = spawn(
        'openssl',
        ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-pass', 'stdin'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const trozos: Buffer[] = [];
      let err = '';

      p.stdout.on('data', (d) => trozos.push(d));
      p.stderr.on('data', (d) => (err += String(d)));
      p.on('error', (e) => reject(new Error(`No se pudo ejecutar openssl: ${e.message}`)));
      p.on('close', (code) =>
        code === 0
          ? resolve(Buffer.concat(trozos))
          : reject(new Error(`openssl salio con ${code}: ${err.slice(0, 200)}`)),
      );

      // La contraseña va por stdin y no por argumento: en la linea de comandos
      // la veria cualquiera con acceso a la lista de procesos.
      p.stdin.write(`${passphrase}\n`);
      p.stdin.write(texto);
      p.stdin.end();
    });
  }

  /** Misma retencion que los volcados de la base: 7 dias. */
  private async purge(): Promise<void> {
    const corte = Date.now() - 7 * 86_400_000;
    const objetos = await this.s3.listPrefix(PREFIX);
    const viejos = objetos.filter((o) => o.modified.getTime() < corte);
    // Nunca dejar el prefijo vacio, por si las fechas fallan.
    if (!viejos.length || viejos.length >= objetos.length) return;
    await this.s3.deleteKeys(viejos.map((o) => o.key));
  }
}
