import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const CHANNEL_PROVIDERS = ['telegram', 'discord', 'slack'] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

/**
 * Alta de un canal que el tenant configura pegando un destino — hoy solo
 * Discord. Telegram se empareja con un codigo y Slack pasa por OAuth, asi que
 * ninguno de los dos entra por aqui: sus destinos los pone el servidor.
 */
export class CreateChannelDto {
  @IsIn(['discord'], { message: 'Solo Discord se da de alta con una URL' })
  provider!: 'discord';

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  label!: string;

  /** URL del webhook del canal de Discord. */
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  target!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: string[];
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  label?: string;

  /** Lista vacia = el canal quiere todos los tipos. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Arranca el emparejamiento de Telegram: devuelve el codigo a enviar al bot. */
export class StartTelegramLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  label!: string;
}

export class ConnectSlackDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}
