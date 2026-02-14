import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TtsService } from './tts.service';
import { GenerateTtsDto, TtsResponseDto } from './dto/tts.dto';

@ApiTags('TTS')
@Controller('tts')
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate TTS audio from text' })
  @ApiResponse({
    status: 200,
    description: 'Audio generated successfully',
    type: TtsResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to generate audio',
  })
  async generateTts(@Body() dto: GenerateTtsDto): Promise<TtsResponseDto> {
    return this.ttsService.generateTts(dto.text, dto.voice);
  }
}
