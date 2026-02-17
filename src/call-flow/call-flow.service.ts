import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CreateCallFlowDto,
  UpdateCallFlowDto,
  CallFlowStep,
  CallFlowStepType,
  TERMINAL_STEP_TYPES,
  CallFlowResponseDto,
  MenuStepConfig,
  ScheduleStepConfig,
} from './dto/call-flow.dto';
import { TtsService } from '../tts/tts.service';
import { TtsVoice } from '../tts/dto/tts.dto';

// MessageConfig interface for TTS generation
interface MessageConfig {
  type: 'tts' | 'recording';
  text?: string;
  recordingUrl?: string;
  voice?: string;
  generatedAudioUrl?: string;
}

@Injectable()
export class CallFlowService {
  private readonly logger = new Logger(CallFlowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ttsService: TtsService,
  ) {}

  /**
   * Validate that terminal steps (voicemail, hangup) are at the end
   * and that there are no steps after them
   */
  private validateTerminalSteps(steps: CallFlowStep[], path = 'root'): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isTerminal = TERMINAL_STEP_TYPES.includes(step.type);

      if (isTerminal && i < steps.length - 1) {
        throw new BadRequestException(
          `Terminal step "${step.type}" at ${path}[${i}] must be the last step. ` +
          `Found ${steps.length - i - 1} step(s) after it.`
        );
      }

      // Recursively validate nested steps in Menu options
      if (step.type === CallFlowStepType.MENU) {
        const config = step.config as MenuStepConfig;
        config.options?.forEach((option, optIdx) => {
          if (option.steps?.length) {
            this.validateTerminalSteps(option.steps, `${path}[${i}].options[${optIdx}]`);
          }
        });
        if (config.invalidInputSteps?.length) {
          this.validateTerminalSteps(config.invalidInputSteps, `${path}[${i}].invalidInputSteps`);
        }
      }

      // Recursively validate nested steps in Schedule branches
      if (step.type === CallFlowStepType.SCHEDULE) {
        const config = step.config as ScheduleStepConfig;
        // Validate each branch's steps
        config.branches?.forEach((branch, branchIdx) => {
          if (branch.steps?.length) {
            this.validateTerminalSteps(branch.steps, `${path}[${i}].branches[${branchIdx}].steps`);
          }
        });
        // Validate fallback steps
        if (config.fallbackSteps?.length) {
          this.validateTerminalSteps(config.fallbackSteps, `${path}[${i}].fallbackSteps`);
        }
      }
    }
  }

  /**
   * Validate step IDs are unique within the flow
   */
  private validateUniqueStepIds(steps: CallFlowStep[], seenIds = new Set<string>()): void {
    for (const step of steps) {
      if (seenIds.has(step.id)) {
        throw new BadRequestException(`Duplicate step ID: "${step.id}"`);
      }
      seenIds.add(step.id);

      // Check nested steps
      if (step.type === CallFlowStepType.MENU) {
        const config = step.config as MenuStepConfig;
        config.options?.forEach((option) => {
          if (option.steps?.length) {
            this.validateUniqueStepIds(option.steps, seenIds);
          }
        });
        if (config.invalidInputSteps?.length) {
          this.validateUniqueStepIds(config.invalidInputSteps, seenIds);
        }
      }

      if (step.type === CallFlowStepType.SCHEDULE) {
        const config = step.config as ScheduleStepConfig;
        // Check each branch's steps
        config.branches?.forEach((branch) => {
          if (branch.steps?.length) {
            this.validateUniqueStepIds(branch.steps, seenIds);
          }
        });
        // Check fallback steps
        if (config.fallbackSteps?.length) {
          this.validateUniqueStepIds(config.fallbackSteps, seenIds);
        }
      }
    }
  }

  /**
   * Validate call flow steps
   */
  private validateSteps(steps: CallFlowStep[]): void {
    if (!steps || steps.length === 0) {
      return; // Empty flow is valid (will use default behavior)
    }

    this.validateTerminalSteps(steps);
    this.validateUniqueStepIds(steps);
  }

  /**
   * Generate TTS audio for a MessageConfig if needed
   * Returns true if audio was generated, false if already exists or not TTS
   */
  private async generateTtsForMessage(message: MessageConfig): Promise<boolean> {
    // Skip if not TTS type
    if (message.type !== 'tts') return false;

    // Skip if no text
    if (!message.text?.trim()) return false;

    // Skip if already has generated audio
    if (message.generatedAudioUrl) return false;

    // Generate TTS
    const voice = (message.voice as TtsVoice) || TtsVoice.ECHO;
    const result = await this.ttsService.generateTts(message.text, voice);
    message.generatedAudioUrl = result.audioUrl;

    this.logger.log(`Generated TTS audio for text: "${message.text.slice(0, 50)}..." -> ${result.audioUrl}`);
    return true;
  }

  /**
   * Recursively process all steps and generate missing TTS audio
   */
  private async generateMissingTtsForSteps(steps: CallFlowStep[]): Promise<number> {
    let generatedCount = 0;

    for (const step of steps) {
      const config = step.config as Record<string, unknown>;

      // Check for message property (Greeting, Menu, KeypadEntry, Hangup)
      if (config.message && typeof config.message === 'object') {
        if (await this.generateTtsForMessage(config.message as MessageConfig)) {
          generatedCount++;
        }
      }

      // Check for greeting property (Voicemail)
      if (config.greeting && typeof config.greeting === 'object') {
        if (await this.generateTtsForMessage(config.greeting as MessageConfig)) {
          generatedCount++;
        }
      }

      // Process nested steps in Menu options
      if (step.type === CallFlowStepType.MENU) {
        const menuConfig = config as unknown as MenuStepConfig;
        if (menuConfig.options) {
          for (const option of menuConfig.options) {
            if (option.steps?.length) {
              generatedCount += await this.generateMissingTtsForSteps(option.steps);
            }
          }
        }
        if (menuConfig.invalidInputSteps?.length) {
          generatedCount += await this.generateMissingTtsForSteps(menuConfig.invalidInputSteps);
        }
      }

      // Process nested steps in Schedule branches
      if (step.type === CallFlowStepType.SCHEDULE) {
        const scheduleConfig = config as unknown as ScheduleStepConfig;
        if (scheduleConfig.branches) {
          for (const branch of scheduleConfig.branches) {
            if (branch.steps?.length) {
              generatedCount += await this.generateMissingTtsForSteps(branch.steps);
            }
          }
        }
        if (scheduleConfig.fallbackSteps?.length) {
          generatedCount += await this.generateMissingTtsForSteps(scheduleConfig.fallbackSteps);
        }
      }
    }

    return generatedCount;
  }

  /**
   * Convert Prisma result to response DTO
   */
  private toResponseDto(
    callFlow: {
      id: string;
      tenantId: string;
      name: string;
      description: string | null;
      isActive: boolean;
      recordInboundCalls: boolean;
      steps: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
    },
    phoneNumberCount?: number,
  ): CallFlowResponseDto {
    return {
      id: callFlow.id,
      tenantId: callFlow.tenantId,
      name: callFlow.name,
      description: callFlow.description ?? undefined,
      isActive: callFlow.isActive,
      recordInboundCalls: callFlow.recordInboundCalls,
      steps: callFlow.steps as unknown as CallFlowStep[],
      createdAt: callFlow.createdAt,
      updatedAt: callFlow.updatedAt,
      phoneNumberCount,
    };
  }

  /**
   * Create a new call flow
   */
  async create(tenantId: string, dto: CreateCallFlowDto): Promise<CallFlowResponseDto> {
    // Validate steps if provided
    if (dto.steps?.length) {
      this.validateSteps(dto.steps);

      // Generate TTS audio for any steps that don't have it
      const generatedCount = await this.generateMissingTtsForSteps(dto.steps);
      if (generatedCount > 0) {
        this.logger.log(`Generated ${generatedCount} TTS audio file(s) for new call flow`);
      }
    }

    const callFlow = await this.prisma.callFlow.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
        recordInboundCalls: dto.recordInboundCalls ?? false,
        steps: (dto.steps ?? []) as unknown as Prisma.InputJsonValue,
      },
      include: {
        _count: {
          select: { phoneNumbers: true },
        },
      },
    });

    return this.toResponseDto(callFlow, callFlow._count.phoneNumbers);
  }

  /**
   * Get all call flows for a tenant
   */
  async findAll(tenantId: string): Promise<CallFlowResponseDto[]> {
    const callFlows = await this.prisma.callFlow.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { phoneNumbers: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return callFlows.map((cf) => this.toResponseDto(cf, cf._count.phoneNumbers));
  }

  /**
   * Get a single call flow by ID
   */
  async findOne(tenantId: string, id: string): Promise<CallFlowResponseDto> {
    const callFlow = await this.prisma.callFlow.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: { phoneNumbers: true },
        },
        phoneNumbers: {
          select: {
            id: true,
            phoneNumber: true,
            friendlyName: true,
          },
        },
      },
    });

    if (!callFlow) {
      throw new NotFoundException(`Call flow with ID "${id}" not found`);
    }

    return this.toResponseDto(callFlow, callFlow._count.phoneNumbers);
  }

  /**
   * Update a call flow
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateCallFlowDto,
  ): Promise<CallFlowResponseDto> {
    this.logger.debug(`=== DEBUG: Update call flow ===`);
    this.logger.debug(`DTO received: ${JSON.stringify(dto, null, 2)}`);
    this.logger.debug(`Steps type: ${typeof dto.steps}, isArray: ${Array.isArray(dto.steps)}`);
    if (dto.steps) {
      this.logger.debug(`Steps length: ${dto.steps.length}`);
      dto.steps.forEach((step, idx) => {
        this.logger.debug(`Step ${idx}: type=${typeof step}, isArray=${Array.isArray(step)}, value=${JSON.stringify(step)}`);
      });
    }

    // Verify call flow exists
    const existing = await this.prisma.callFlow.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Call flow with ID "${id}" not found`);
    }

    // Validate steps if provided
    if (dto.steps?.length) {
      this.validateSteps(dto.steps);

      // Generate TTS audio for any steps that don't have it
      const generatedCount = await this.generateMissingTtsForSteps(dto.steps);
      if (generatedCount > 0) {
        this.logger.log(`Generated ${generatedCount} TTS audio file(s) for call flow update`);
      }
    }

    // Build update data
    const updateData: Prisma.CallFlowUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.recordInboundCalls !== undefined) updateData.recordInboundCalls = dto.recordInboundCalls;
    if (dto.steps !== undefined) updateData.steps = dto.steps as unknown as Prisma.InputJsonValue;

    this.logger.debug(`Update data steps: ${JSON.stringify(updateData.steps, null, 2)}`);

    const callFlow = await this.prisma.callFlow.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { phoneNumbers: true },
        },
      },
    });

    return this.toResponseDto(callFlow, callFlow._count.phoneNumbers);
  }

  /**
   * Delete a call flow
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const callFlow = await this.prisma.callFlow.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: { phoneNumbers: true },
        },
      },
    });

    if (!callFlow) {
      throw new NotFoundException(`Call flow with ID "${id}" not found`);
    }

    if (callFlow._count.phoneNumbers > 0) {
      throw new BadRequestException(
        `Cannot delete call flow: it is assigned to ${callFlow._count.phoneNumbers} phone number(s). ` +
        `Unassign the phone numbers first.`
      );
    }

    await this.prisma.callFlow.delete({
      where: { id },
    });
  }

  /**
   * Duplicate a call flow
   */
  async duplicate(tenantId: string, id: string, newName?: string): Promise<CallFlowResponseDto> {
    const original = await this.findOne(tenantId, id);

    return this.create(tenantId, {
      name: newName || `${original.name} (Copy)`,
      description: original.description,
      isActive: false, // New copy is inactive by default
      recordInboundCalls: original.recordInboundCalls,
      steps: original.steps,
    });
  }

  /**
   * Assign a call flow to a phone number
   */
  async assignToPhoneNumber(
    tenantId: string,
    phoneNumberId: string,
    callFlowId: string | null,
  ): Promise<void> {
    // Verify phone number belongs to tenant
    const phoneNumber = await this.prisma.twilioPhoneNumber.findFirst({
      where: { id: phoneNumberId, tenantId },
    });

    if (!phoneNumber) {
      throw new NotFoundException(`Phone number with ID "${phoneNumberId}" not found`);
    }

    // If callFlowId is provided, verify it exists and belongs to tenant
    if (callFlowId) {
      const callFlow = await this.prisma.callFlow.findFirst({
        where: { id: callFlowId, tenantId },
      });

      if (!callFlow) {
        throw new NotFoundException(`Call flow with ID "${callFlowId}" not found`);
      }
    }

    await this.prisma.twilioPhoneNumber.update({
      where: { id: phoneNumberId },
      data: { callFlowId },
    });
  }

  /**
   * Get call flow for a phone number (used by webhook)
   */
  async getCallFlowForPhoneNumber(phoneNumberId: string): Promise<{
    callFlow: CallFlowResponseDto | null;
    phoneNumber: {
      id: string;
      phoneNumber: string;
      tenantId: string;
    };
  } | null> {
    const phoneNumber = await this.prisma.twilioPhoneNumber.findUnique({
      where: { id: phoneNumberId },
      include: {
        callFlow: true,
      },
    });

    if (!phoneNumber) {
      return null;
    }

    return {
      phoneNumber: {
        id: phoneNumber.id,
        phoneNumber: phoneNumber.phoneNumber,
        tenantId: phoneNumber.tenantId,
      },
      callFlow: phoneNumber.callFlow
        ? this.toResponseDto(phoneNumber.callFlow)
        : null,
    };
  }

  /**
   * Find a TenantUser by their User ID and Tenant ID
   * Used to associate users with calls they answered
   */
  async findTenantUserByUserId(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    const tenantUser = await this.prisma.tenantUser.findFirst({
      where: {
        tenantId,
        userId,
      },
      select: { id: true },
    });

    return tenantUser;
  }
}
