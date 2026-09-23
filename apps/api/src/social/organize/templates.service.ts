import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type SocialTemplate } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { BUILT_IN_TEMPLATES } from './built-in-templates';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';

const BUILT_IN_PREFIX = 'builtin:';

export interface SocialTemplateView {
  id: string;
  name: string;
  content: string;
  category: string | null;
  builtIn: boolean;
}

function toView(template: SocialTemplate): SocialTemplateView {
  return { id: template.id, name: template.name, content: template.content, category: template.category, builtIn: false };
}

@Injectable()
export class SocialTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<SocialTemplateView[]> {
    const rows = await this.prisma.socialTemplate.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return [...BUILT_IN_TEMPLATES, ...rows.map(toView)];
  }

  async create(tenantId: string, dto: CreateTemplateDto): Promise<SocialTemplateView> {
    const row = await this.prisma.socialTemplate.create({ data: { tenantId, name: dto.name, content: dto.content, category: dto.category ?? null } });
    return toView(row);
  }

  async update(tenantId: string, id: string, dto: UpdateTemplateDto): Promise<SocialTemplateView> {
    this.rejectBuiltIn(id);
    await this.ensureTemplate(id, tenantId);
    const row = await this.prisma.socialTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.category !== undefined && { category: dto.category }),
      },
    });
    return toView(row);
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    this.rejectBuiltIn(id);
    await this.ensureTemplate(id, tenantId);
    await this.prisma.socialTemplate.delete({ where: { id } });
    return { id };
  }

  private rejectBuiltIn(id: string): void {
    if (id.startsWith(BUILT_IN_PREFIX)) throw new BadRequestException('Las plantillas predefinidas no se pueden editar ni eliminar');
  }

  private async ensureTemplate(id: string, tenantId: string): Promise<SocialTemplate> {
    const template = await this.prisma.socialTemplate.findFirst({ where: { id, tenantId } });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    return template;
  }
}
