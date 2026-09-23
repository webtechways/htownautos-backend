import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SocialTag } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { CreateTagDto, UpdateTagDto } from './dto';

export interface SocialTagView {
  id: string;
  name: string;
  color: string;
}

function toView(tag: SocialTag): SocialTagView {
  return { id: tag.id, name: tag.name, color: tag.color };
}

@Injectable()
export class SocialTagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<SocialTagView[]> {
    const rows = await this.prisma.socialTag.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return rows.map(toView);
  }

  async create(tenantId: string, dto: CreateTagDto): Promise<SocialTagView> {
    try {
      const row = await this.prisma.socialTag.create({ data: { tenantId, name: dto.name, color: dto.color } });
      return toView(row);
    } catch (err) {
      throw this.mapUniqueError(err);
    }
  }

  async update(tenantId: string, id: string, dto: UpdateTagDto): Promise<SocialTagView> {
    await this.ensureTag(id, tenantId);
    try {
      const row = await this.prisma.socialTag.update({ where: { id }, data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.color !== undefined && { color: dto.color }) } });
      return toView(row);
    } catch (err) {
      throw this.mapUniqueError(err);
    }
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    await this.ensureTag(id, tenantId);
    await this.prisma.socialTag.delete({ where: { id } });
    return { id };
  }

  private async ensureTag(id: string, tenantId: string): Promise<SocialTag> {
    const tag = await this.prisma.socialTag.findFirst({ where: { id, tenantId } });
    if (!tag) throw new NotFoundException('Etiqueta no encontrada');
    return tag;
  }

  private mapUniqueError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Ya existe una etiqueta con ese nombre');
    }
    return err as Error;
  }
}
