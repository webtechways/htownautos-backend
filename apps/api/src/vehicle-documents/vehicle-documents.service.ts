import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { DocusealClient } from './docuseal.client';
import { mapear130U, type Datos130U } from './forms/form-130u';

/**
 * Los tramites que se pueden generar. El `templateId` es el de la instancia de
 * DocuSeal; si algun dia se recrean las plantillas, este es el unico sitio que
 * hay que tocar.
 */
export const FORMULARIOS = [
  { key: 'form-130-u', name: 'Title Process (Form 130-U)', templateId: 1, implementado: true },
  { key: 'vtr-66', name: 'Temporal Plate (VTR-66)', templateId: 2, implementado: false },
  { key: 'vtr-271', name: 'Power of Attorney (VTR-271)', templateId: 3, implementado: false },
  { key: 'vtr-34', name: 'Copy of Title (VTR-34)', templateId: 5, implementado: false },
  { key: 'vtr-61', name: 'Rebuilt Vehicle Statement (VTR-61)', templateId: 9, implementado: false },
  { key: 'vtr-441', name: 'Salvage or Nonrepairable (VTR-441)', templateId: 8, implementado: false },
  { key: '14-317', name: 'Gift Transfer (14-317)', templateId: 6, implementado: false },
  { key: 'mv-015', name: 'Bill of Sale (MV-015)', templateId: 4, implementado: false },
] as const;

@Injectable()
export class VehicleDocumentsService {
  private readonly logger = new Logger(VehicleDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docuseal: DocusealClient,
    private readonly s3: S3Service,
  ) {}

  formularios() {
    return FORMULARIOS.map((f) => ({ ...f, disponible: f.implementado && this.docuseal.configurado }));
  }

  /**
   * Datos del vehiculo y del cliente para prellenar el asistente.
   *
   * Se devuelve en la forma que consume el formulario, no en la del modelo: la
   * pantalla no tiene por que saber que el color vive en `exteriorColor` ni que
   * el año es una relacion.
   */
  async prefill(vehicleId: string, buyerId?: string) {
    const vehiculo = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { year: true, make: true, model: true, bodyType: true, titles: true },
    });
    if (!vehiculo) throw new NotFoundException('Vehiculo no encontrado');

    const buyer = buyerId
      ? await this.prisma.buyer.findUnique({ where: { id: buyerId } })
      : null;

    return {
      vehiculo: {
        vin: vehiculo.vin,
        year: vehiculo.year?.year ? String(vehiculo.year.year) : undefined,
        make: vehiculo.make?.name,
        model: vehiculo.model?.name,
        bodyStyle: vehiculo.bodyType?.title,
        majorColor: vehiculo.exteriorColor ?? undefined,
        minorColor: vehiculo.interiorColor ?? undefined,
        odometer: vehiculo.mileage != null ? String(vehiculo.mileage) : undefined,
      },
      cliente: buyer
        ? {
            buyerId: buyer.id,
            applicantName: [buyer.firstName, buyer.middleName, buyer.lastName, buyer.suffix]
              .filter(Boolean)
              .join(' '),
            applicantType: buyer.applicantType ?? (buyer.isBusinessBuyer ? 'BUSINESS' : 'INDIVIDUAL'),
            mailingAddress: buyer.currentAddress,
            mailingCity: buyer.currentCity,
            mailingState: buyer.currentState,
            mailingZip: buyer.currentZipCode,
            countyOfResidence: buyer.countyOfResidence ?? undefined,
            phone: buyer.phoneMobile || buyer.phoneMain,
            email: buyer.email,
            // Para una empresa el 130-U pide el EIN en la misma casilla que el
            // numero de documento de una persona.
            photoIdNumber: buyer.isBusinessBuyer
              ? buyer.businessEIN ?? undefined
              : buyer.driversLicenseNumber || buyer.idNumber || undefined,
            idIssuedBy: buyer.driversLicenseState ?? undefined,
            idType: buyer.driversLicenseNumber ? 'US_DRIVER_LICENSE' : undefined,
            militaryStatus: buyer.militaryStatus ?? undefined,
            communicationImpediment: buyer.communicationImpediment,
          }
        : null,
    };
  }

  /** Genera el documento en DocuSeal y lo asocia al vehiculo. */
  async generar(params: {
    vehicleId: string;
    formKey: string;
    buyerId?: string;
    values: Datos130U;
    tenantId?: string | null;
    userId?: string | null;
  }) {
    const form = FORMULARIOS.find((f) => f.key === params.formKey);
    if (!form) throw new BadRequestException(`Formulario desconocido: ${params.formKey}`);
    if (!form.implementado) throw new BadRequestException(`${form.name} todavia no esta disponible`);

    const vehiculo = await this.prisma.vehicle.findUnique({
      where: { id: params.vehicleId },
      select: { id: true, vin: true },
    });
    if (!vehiculo) throw new NotFoundException('Vehiculo no encontrado');

    const values = mapear130U(params.values);

    // El correo del solicitante es a quien se le pedira la firma. Si no hay, se
    // usa uno interno: la submission se crea igual y se manda despues.
    const email = params.values.email || 'documentos@htownautos.com';

    const [submitter] = await this.docuseal.crearSubmission({
      templateId: form.templateId,
      email,
      nombre: params.values.applicantName,
      values,
      externalId: `${params.vehicleId}:${form.key}`,
    });

    // Lo que se pregunto y el cliente no tenia se le guarda: la segunda vez que
    // haga un tramite, el condado y el tipo de solicitante ya vienen puestos.
    if (params.buyerId) await this.recordarEnCliente(params.buyerId, params.values);

    return this.prisma.vehicleDocument.create({
      data: {
        tenantId: params.tenantId ?? null,
        vehicleId: params.vehicleId,
        buyerId: params.buyerId ?? null,
        formKey: form.key,
        formName: form.name,
        templateId: form.templateId,
        submissionId: submitter.submission_id,
        submitterSlug: submitter.slug,
        status: 'draft',
        values: values as any,
        createdById: params.userId ?? null,
      },
    });
  }

  private async recordarEnCliente(buyerId: string, d: Datos130U) {
    const datos: Record<string, unknown> = {};
    if (d.countyOfResidence) datos.countyOfResidence = d.countyOfResidence;
    if (d.applicantType) datos.applicantType = d.applicantType;
    if (d.militaryStatus) datos.militaryStatus = d.militaryStatus;
    if (d.communicationImpediment !== undefined) {
      datos.communicationImpediment = d.communicationImpediment;
    }
    if (!Object.keys(datos).length) return;
    await this.prisma.buyer
      .update({ where: { id: buyerId }, data: datos })
      .catch((e) => this.logger.warn(`[Docs] No se pudo guardar en el cliente ${buyerId}: ${e.message}`));
  }

  /**
   * Los tramites de un vehiculo, con el estado al dia.
   *
   * Se pregunta a DocuSeal solo por los que aun no estan firmados: los
   * completados ya no cambian y consultarlos seria una llamada por documento y
   * por visita a la pestana.
   */
  async listar(vehicleId: string) {
    const filas = await this.prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
      include: { media: { select: { id: true, url: true, filename: true, isPublic: true } } },
    });

    const pendientes = filas.filter((f) => f.status !== 'completed' && f.status !== 'declined');
    await Promise.all(pendientes.map((f) => this.sincronizar(f.id).catch(() => undefined)));

    if (!pendientes.length) return filas.map((f) => this.conUrl(f));

    const frescas = await this.prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
      include: { media: { select: { id: true, url: true, filename: true, isPublic: true } } },
    });
    return frescas.map((f) => this.conUrl(f));
  }

  private conUrl<T extends { submitterSlug: string }>(f: T) {
    return { ...f, signUrl: this.docuseal.urlDeFirma(f.submitterSlug) };
  }

  /**
   * Trae el estado desde DocuSeal y, si ya esta firmado, archiva el PDF.
   *
   * El PDF se guarda como Media del vehiculo porque es donde el usuario ya
   * busca sus documentos; que venga de DocuSeal es un detalle de implementacion
   * que no deberia obligarle a mirar en dos sitios.
   */
  async sincronizar(id: string) {
    const fila = await this.prisma.vehicleDocument.findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('Documento no encontrado');

    const sub = await this.docuseal.submission(fila.submissionId);
    const submitter = sub.submitters?.[0];
    const estado = submitter?.declined_at ? 'declined' : submitter?.status ?? fila.status;
    const completado = Boolean(submitter?.completed_at);

    let mediaId = fila.mediaId;
    if (completado && !mediaId && sub.documents?.length) {
      mediaId = await this.archivarPdf(fila.vehicleId, fila.formName, sub.documents[0]);
    }

    return this.prisma.vehicleDocument.update({
      where: { id },
      data: {
        status: completado ? 'completed' : estado,
        completedAt: submitter?.completed_at ? new Date(submitter.completed_at) : fila.completedAt,
        auditLogUrl: sub.audit_log_url ?? fila.auditLogUrl,
        mediaId,
      },
    });
  }

  private async archivarPdf(vehicleId: string, nombre: string, doc: { name: string; url: string }) {
    const pdf = await this.docuseal.descargar(doc.url);
    const key = `vehicles/${vehicleId}/documents/${Date.now()}-${doc.name || 'documento'}.pdf`;
    await this.s3.uploadBufferToKey(pdf, key, 'application/pdf');

    const media = await this.prisma.media.create({
      data: {
        filename: `${nombre}.pdf`,
        url: key,
        path: key,
        mimeType: 'application/pdf',
        size: pdf.length,
        mediaType: 'document',
        category: 'title-documents',
        storageKey: key,
        // Un 130-U firmado lleva numero de documento de identidad y direccion:
        // nunca publico.
        isPublic: false,
        vehicleId,
      },
      select: { id: true },
    });
    this.logger.log(`[Docs] ${nombre} firmado y archivado para el vehiculo ${vehicleId}`);
    return media.id;
  }

  /** Manda el correo de firma al destinatario indicado. */
  async enviar(id: string, email: string) {
    const fila = await this.prisma.vehicleDocument.findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('Documento no encontrado');

    const sub = await this.docuseal.submission(fila.submissionId);
    const submitter = sub.submitters?.[0];
    if (!submitter) throw new BadRequestException('La submission no tiene destinatario');

    await this.docuseal.enviarAFirmar(submitter.id, email);
    return this.prisma.vehicleDocument.update({
      where: { id },
      data: { status: 'sent', sentTo: email, sentAt: new Date() },
    });
  }

  /** Quita el tramite: se archiva en DocuSeal y se borra la fila. */
  async eliminar(id: string) {
    const fila = await this.prisma.vehicleDocument.findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('Documento no encontrado');
    await this.docuseal.archivarSubmission(fila.submissionId).catch(() => undefined);
    await this.prisma.vehicleDocument.delete({ where: { id } });
    return { ok: true };
  }
}
