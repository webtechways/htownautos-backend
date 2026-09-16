import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Lo que devuelve DocuSeal al crear o consultar una submission. */
export interface DocusealSubmitter {
  id: number;
  slug: string;
  email: string | null;
  status: string;
  submission_id: number;
  completed_at: string | null;
  declined_at: string | null;
}

export interface DocusealSubmission {
  id: number;
  status: string;
  audit_log_url: string | null;
  documents: Array<{ name: string; url: string }>;
  submitters: DocusealSubmitter[];
}

/**
 * Cliente de la instancia propia de DocuSeal (docs.htownautos.com).
 *
 * Es deliberadamente delgado: aqui no se decide nada de negocio, solo se habla
 * HTTP. La clave vive en la variable `DOCUSEAL`.
 */
@Injectable()
export class DocusealClient {
  private readonly logger = new Logger(DocusealClient.name);
  private readonly base = (process.env.DOCUSEAL_URL || 'https://docs.htownautos.com').replace(/\/+$/, '');
  private readonly token = process.env.DOCUSEAL || '';

  get configurado() {
    return Boolean(this.token);
  }

  private async pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) {
      throw new ServiceUnavailableException('DocuSeal no esta configurado (falta la variable DOCUSEAL)');
    }
    const res = await fetch(`${this.base}/api${ruta}`, {
      ...init,
      headers: {
        'X-Auth-Token': this.token,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const cuerpo = (await res.text()).slice(0, 300);
      this.logger.warn(`[DocuSeal] ${init.method ?? 'GET'} ${ruta} -> ${res.status} ${cuerpo}`);
      throw new ServiceUnavailableException(`DocuSeal respondio ${res.status}: ${cuerpo}`);
    }
    return (await res.json()) as T;
  }

  listarPlantillas() {
    return this.pedir<{ data: Array<{ id: number; name: string }> }>('/templates?limit=100');
  }

  plantilla(id: number) {
    return this.pedir<{ id: number; name: string; fields: Array<{ name: string; type: string }> }>(
      `/templates/${id}`,
    );
  }

  /**
   * Crea la submission con los campos ya rellenos.
   *
   * `send_email: false` siempre: el correo se manda despues, a proposito y
   * cuando el usuario lo pide. Generar un documento no debe escribir a nadie.
   */
  async crearSubmission(params: {
    templateId: number;
    email: string;
    nombre?: string;
    values: Record<string, unknown>;
    externalId?: string;
  }): Promise<DocusealSubmitter[]> {
    return this.pedir<DocusealSubmitter[]>('/submissions', {
      method: 'POST',
      body: JSON.stringify({
        template_id: params.templateId,
        send_email: false,
        submitters: [
          {
            role: 'First Party',
            email: params.email,
            name: params.nombre,
            external_id: params.externalId,
            values: params.values,
          },
        ],
      }),
    });
  }

  submission(id: number) {
    return this.pedir<DocusealSubmission>(`/submissions/${id}`);
  }

  archivarSubmission(id: number) {
    return this.pedir<{ id: number; archived_at: string }>(`/submissions/${id}`, { method: 'DELETE' });
  }

  /** Cambia el destinatario y dispara el correo de firma. */
  enviarAFirmar(submitterId: number, email: string) {
    return this.pedir<DocusealSubmitter>(`/submitters/${submitterId}`, {
      method: 'PUT',
      body: JSON.stringify({ email, send_email: true }),
    });
  }

  /** URL publica donde se firma o se imprime el documento. */
  urlDeFirma(slug: string) {
    return `${this.base}/s/${slug}`;
  }

  async descargar(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new ServiceUnavailableException(`No se pudo descargar el PDF (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}
