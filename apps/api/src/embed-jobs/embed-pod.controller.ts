import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '@htownautos/auth';
import { AuctionIngestGuard } from '../auction-sale-results/auction-ingest.guard';
import { EmbedJobsService } from './embed-jobs.service';
import { ficheroPca, rutaAsset } from '@htownautos/common';

/** Ficheros que el pod se descarga al arrancar. Nada mas se sirve por aqui. */
const ASSETS: Record<string, string> = {
  'bootstrap.sh': 'text/x-shellscript',
  'worker.py': 'text/x-python',
  'pca_img_mean.npz': 'application/octet-stream',
  'pca_img_slots.npz': 'application/octet-stream',
};

/**
 * Lo que llama el pod alquilado: su codigo de arranque y las rutas por las que
 * devuelve resultados.
 *
 * Va por el mismo guard de clave compartida que usan las VM scraper. El pod es
 * una maquina externa y efimera, y este camino existe para que NO necesite
 * credenciales de Postgres: solo sabe leer de B2 y hablar con estas rutas.
 */
@ApiExcludeController()
@Controller('embed-pod')
@Public()
@UseGuards(AuctionIngestGuard)
export class EmbedPodController {
  constructor(private readonly service: EmbedJobsService) {}

  /**
   * Codigo que ejecuta el pod al arrancar. Se sirve desde aqui en vez de meterlo
   * en una imagen propia: asi el worker y el PCA son siempre los de la version
   * desplegada del backend, y no puede quedar una imagen vieja generando vectores
   * incompatibles con el modelo en produccion.
   */
  @Get('bootstrap.sh')
  bootstrap(@Res() res: Response): void {
    this.sendAsset('bootstrap.sh', res);
  }

  @Get('worker.py')
  worker(@Res() res: Response): void {
    this.sendAsset('worker.py', res);
  }

  /**
   * El PCA congelado, versionado junto al backend.
   *
   * Se sirve el que corresponde a la agrupacion activa (`mean` o `slots`): el
   * pod no elige nada, aplica el que le llega y devuelve la etiqueta que trae
   * dentro. Asi no puede haber un pod calculando con una agrupacion y una
   * config diciendo otra.
   */
  @Get('pca_img.npz')
  async pca(@Res() res: Response): Promise<void> {
    const cfg = await this.service.config();
    const nombre = ficheroPca(cfg.pooling);
    // Si el PCA de esa agrupacion no esta desplegado, mejor 404 que servir el
    // otro en silencio: los vectores saldrian con la etiqueta equivocada.
    if (!rutaAsset(nombre)) {
      res.status(404).send(`asset ${nombre} no desplegado`);
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(rutaAsset(nombre)!).pipe(res);
  }

  @Get(':runId/manifest')
  manifest(
    @Param('runId') runId: string,
    @Query('maxSeq') maxSeq?: string,
    @Query('offset') offset?: string,
    @Query('lots') lots?: string,
  ) {
    return this.service.manifest(
      runId,
      Number(maxSeq) || 9,
      Number(offset) || 0,
      Number(lots) || 2000,
    );
  }

  @Post(':runId/vectors')
  vectors(
    @Param('runId') runId: string,
    @Body() body: {
      items: { lot: string; vector: number[]; imageCount: number }[];
      encoder: string;
      pcaVersion: string;
    },
  ) {
    return this.service.saveVectors(runId, body.items ?? [], body.encoder, body.pcaVersion);
  }

  @Post(':runId/log')
  log(@Param('runId') runId: string, @Body() body: { line: string }) {
    return this.service.appendLog(runId, body.line ?? '');
  }

  @Post(':runId/complete')
  complete(
    @Param('runId') runId: string,
    @Body() body: { imagesDone?: number; imagesFailed?: number; error?: string },
  ) {
    return this.service.complete(runId, body ?? {});
  }

  /**
   * Los assets no pasan por el build de nx (no son TypeScript), asi que su ruta
   * cambia entre desarrollo y el contenedor. Se prueban las tres posibles en vez
   * de depender de una configuracion de copiado que es facil que se rompa en
   * silencio al tocar el Dockerfile.
   */
  private sendAsset(nombre: string, res: Response): void {
    const tipo = ASSETS[nombre];
    if (!tipo) {
      res.status(404).send('no encontrado');
      return;
    }
    const candidatos = [
      join(process.cwd(), 'assets', 'embed-jobs', nombre),
      join(__dirname, 'assets', nombre),
      join(process.cwd(), 'apps', 'api', 'src', 'embed-jobs', 'assets', nombre),
    ];
    const ruta = candidatos.find((p) => existsSync(p));
    if (!ruta) {
      res.status(404).send(`asset ${nombre} no encontrado`);
      return;
    }
    res.setHeader('Content-Type', tipo);
    createReadStream(ruta).pipe(res);
  }
}
