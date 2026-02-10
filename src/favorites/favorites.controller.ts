import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { ToggleFavoriteDto, FavoriteType } from './dto/toggle-favorite.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CognitoJwtGuard } from '../auth/guards/cognito-jwt.guard';

@Controller('favorites')
@UseGuards(CognitoJwtGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  async addFavorite(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ToggleFavoriteDto,
  ) {
    return this.favoritesService.addFavorite(
      tenantId,
      user.id,
      dto.listingId,
      dto.type,
    );
  }

  @Delete()
  async removeFavorite(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ToggleFavoriteDto,
  ) {
    return this.favoritesService.removeFavorite(
      tenantId,
      user.id,
      dto.listingId,
      dto.type,
    );
  }

  @Get('ids')
  async getFavoriteIds(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: { id: string },
    @Query('type') type: FavoriteType,
  ) {
    const ids = await this.favoritesService.getFavoriteIds(
      tenantId,
      user.id,
      type,
    );
    return { ids };
  }

  @Get('check/:listingId')
  async checkFavorite(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: { id: string },
    @Param('listingId') listingId: string,
    @Query('type') type: FavoriteType,
  ) {
    const isFavorite = await this.favoritesService.isFavorite(
      tenantId,
      user.id,
      listingId,
      type,
    );
    return { isFavorite };
  }
}
