
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Headers } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ApiTags, ApiHeader } from '@nestjs/swagger';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuditLog } from '../common/decorators/audit-log.decorator';

@ApiTags('Roles')
@ApiHeader({
    name: 'x-tenant-id',
    description: 'Tenant ID',
    required: true,
})
@UseGuards(PermissionsGuard)
@Controller('roles')
export class RolesController {
    constructor(private readonly rolesService: RolesService) { }

    @Post()
    @RequirePermissions('role:create')
    @AuditLog({ action: 'create', resource: 'role', level: 'critical', pii: false })
    create(@Body() createRoleDto: CreateRoleDto, @Headers('x-tenant-id') tenantId: string) {
        return this.rolesService.create(createRoleDto, tenantId);
    }

    @Get()
    @RequirePermissions('role:read')
    @AuditLog({ action: 'read', resource: 'role', level: 'medium', pii: false })
    findAll(@Headers('x-tenant-id') tenantId: string) {
        return this.rolesService.findAll(tenantId);
    }

    @Get(':id')
    @RequirePermissions('role:read')
    @AuditLog({ action: 'read', resource: 'role', level: 'medium', pii: false })
    findOne(@Param('id') id: string, @Headers('x-tenant-id') tenantId: string) {
        return this.rolesService.findOne(id, tenantId);
    }

    @Patch(':id')
    @RequirePermissions('role:update')
    @AuditLog({ action: 'update', resource: 'role', level: 'critical', pii: false })
    update(
        @Param('id') id: string,
        @Body() updateRoleDto: UpdateRoleDto,
        @Headers('x-tenant-id') tenantId: string
    ) {
        return this.rolesService.update(id, updateRoleDto, tenantId);
    }

    @Delete(':id')
    @RequirePermissions('role:delete')
    @AuditLog({ action: 'delete', resource: 'role', level: 'critical', pii: false })
    remove(@Param('id') id: string, @Headers('x-tenant-id') tenantId: string) {
        return this.rolesService.remove(id, tenantId);
    }
}
