export declare const CHANNEL_PROVIDERS: readonly ["telegram", "discord", "slack"];
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];
export declare class CreateChannelDto {
    provider: 'discord';
    label: string;
    target: string;
    types?: string[];
}
export declare class UpdateChannelDto {
    label?: string;
    types?: string[];
    isActive?: boolean;
}
export declare class StartTelegramLinkDto {
    label: string;
}
export declare class ConnectSlackDto {
    code: string;
    redirectUri?: string;
    label?: string;
}
