import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentTenant } from '@htownautos/auth';
import type { AuthenticatedUser } from '@htownautos/auth';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { GenerateDocumentDto, SendDocumentDto } from './dto/generate-document.dto';

/**
 * Tramites de un vehiculo (130-U y demas formularios de Texas).
 *
 * Los guards globales (ApiKey → Clerk → Tenant) ya aplican: NO se anade
 * @UseGuards aqui, que en este proyecto provoco un bucle de arranque.
 */
@ApiTags('Vehicle Documents')
@Controller('vehicle-documents')
export class VehicleDocumentsController {
  constructor(private readonly service: VehicleDocumentsService) {}

  @Get('forms')
  @ApiOperation({ summary: 'Formularios que se pueden generar' })
  formularios() {
    return this.service.formularios();
  }

  @Get('prefill')
  @ApiOperation({ summary: 'Datos del vehiculo y del cliente para el asistente' })
  prefill(@Query('vehicleId') vehicleId: string, @Query('buyerId') buyerId?: string) {
    return this.service.prefill(vehicleId, buyerId);
  }

  @Get()
  @ApiOperation({ summary: 'Tramites de un vehiculo' })
  listar(@Query('vehicleId') vehicleId: string) {
    return this.service.listar(vehicleId);
  }

  @Post()
  @ApiOperation({ summary: 'Generar el documento en DocuSeal' })
  generar(
    @Body() dto: GenerateDocumentDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.generar({
      vehicleId: dto.vehicleId,
      formKey: dto.formKey,
      buyerId: dto.buyerId,
      values: dto.values,
      tenantId,
      userId: user?.id ?? null,
    });
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Enviar por correo para firmar' })
  enviar(@Param('id') id: string, @Body() dto: SendDocumentDto) {
    return this.service.enviar(id, dto.email);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Refrescar el estado desde DocuSeal' })
  sincronizar(@Param('id') id: string) {
    return this.service.sincronizar(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Quitar el tramite' })
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
