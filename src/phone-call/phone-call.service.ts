import { Injectable, Logger, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { S3Service } from '../media/s3.service';
import { TranscriptionService } from './transcription.service';
import { TwilioService } from '../twilio/twilio.service';
import { PhoneCallEventsService, PhoneCallEvent } from '../presence/phone-call-events.service';
import { normalizePhoneNumber } from '../common/utils/phone.utils';

export interface CreateCallInput {
  tenantId: string;
  twilioCallSid: string;
  direction: 'inbound' | 'outbound';
  fromNumber: string;
  toNumber: string;
  status?: string;
  callerId?: string; // TenantUser ID
}

export interface UpdateCallInput {
  status?: string;
  answeredAt?: Date;
  endedAt?: Date;
  duration?: number;
  outcome?: string;
  notes?: string;
  recordingUrl?: string;
  recordingDuration?: number;
  twilioRecordingSid?: string;
  transcription?: string;
  transcriptionStatus?: string;
}

@Injectable()
export class PhoneCallService {
  private readonly logger = new Logger(PhoneCallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    @Inject(forwardRef(() => TranscriptionService))
    private readonly transcriptionService: TranscriptionService,
    private readonly twilioService: TwilioService,
    private readonly phoneCallEventsService: PhoneCallEventsService,
  ) {}

  /**
   * Convert a PhoneCall record to a PhoneCallEvent for WebSocket emission
   * Fetches related data (caller, buyer, transferredTo, transferredFrom) if not already included
   */
  private async toCallEvent(call: any): Promise<PhoneCallEvent> {
    // If related data is not already included, fetch it
    let caller = call.caller;
    let buyer = call.buyer;
    let transferredTo = call.transferredTo;
    let transferredFrom = call.transferredFrom;

    if (!caller && call.callerId) {
      caller = await this.prisma.tenantUser.findUnique({
        where: { id: call.callerId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    }

    if (!buyer && call.buyerId) {
      buyer = await this.prisma.buyer.findUnique({
        where: { id: call.buyerId },
        select: { id: true, firstName: true, lastName: true, phoneMain: true },
      });
    }

    if (!transferredTo && call.transferredToUserId) {
      transferredTo = await this.prisma.tenantUser.findUnique({
        where: { id: call.transferredToUserId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    }

    if (!transferredFrom && call.transferredFromUserId) {
      transferredFrom = await this.prisma.tenantUser.findUnique({
        where: { id: call.transferredFromUserId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    }

    return {
      id: call.id,
      tenantId: call.tenantId,
      direction: call.direction,
      status: call.status,
      outcome: call.outcome,
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      startedAt: call.startedAt?.toISOString() || new Date().toISOString(),
      answeredAt: call.answeredAt?.toISOString() || null,
      endedAt: call.endedAt?.toISOString() || null,
      duration: call.duration,
      buyerId: call.buyerId,
      callerId: call.callerId,
      recordingUrl: call.recordingUrl,
      transcription: call.transcription,
      transcriptionStatus: call.transcriptionStatus,
      caller: caller
        ? {
            id: caller.id,
            user: {
              id: caller.user.id,
              firstName: caller.user.firstName,
              lastName: caller.user.lastName,
              email: caller.user.email,
            },
          }
        : null,
      buyer: buyer
        ? {
            id: buyer.id,
            firstName: buyer.firstName,
            lastName: buyer.lastName,
            phoneMain: buyer.phoneMain,
          }
        : null,
      transferredAt: call.transferredAt?.toISOString() || null,
      transferReason: call.transferReason || null,
      transferredTo: transferredTo
        ? {
            id: transferredTo.id,
            user: {
              id: transferredTo.user.id,
              firstName: transferredTo.user.firstName,
              lastName: transferredTo.user.lastName,
              email: transferredTo.user.email,
            },
          }
        : null,
      transferredFrom: transferredFrom
        ? {
            id: transferredFrom.id,
            user: {
              id: transferredFrom.user.id,
              firstName: transferredFrom.user.firstName,
              lastName: transferredFrom.user.lastName,
              email: transferredFrom.user.email,
            },
          }
        : null,
    };
  }

  /**
   * Create a new phone call record
   * Automatically tries to match the phone number to a buyer
   *
   * For INBOUND calls: fromNumber is the external caller (potential buyer)
   * For OUTBOUND calls: toNumber is the external number being called (potential buyer)
   */
  async createCall(input: CreateCallInput) {
    const { tenantId, twilioCallSid, direction, fromNumber, toNumber, status, callerId } = input;

    this.logger.log(`createCall: direction=${direction}, from=${fromNumber}, to=${toNumber}, callerId=${callerId}, tenantId=${tenantId}`);

    // Determine which phone number to use for buyer lookup
    // Inbound: the caller (fromNumber) is the potential buyer
    // Outbound: the number being called (toNumber) is the potential buyer
    const externalNumber = direction === 'inbound' ? fromNumber : toNumber;

    this.logger.log(`createCall: Looking up buyer by external number: ${externalNumber}`);

    // Try to find a matching buyer by phone number
    const buyerId = await this.findBuyerByPhone(tenantId, externalNumber);

    // Normalize phone numbers for storage (E.164 format)
    const normalizedFrom = this.normalizePhone(fromNumber);
    const normalizedTo = this.normalizePhone(toNumber);

    const call = await this.prisma.phoneCall.create({
      data: {
        tenantId,
        twilioCallSid,
        direction,
        fromNumber: normalizedFrom,
        toNumber: normalizedTo,
        status: status || 'initiated',
        callerId: callerId || null,
        buyerId: buyerId || null,
        startedAt: new Date(),
      },
    });

    this.logger.log(`createCall: Created call ${call.id} - twilioSid=${twilioCallSid}, buyerId=${buyerId || 'none'}, callerId=${callerId || 'none'}`);

    // Emit real-time event
    this.phoneCallEventsService.emitCallCreated(await this.toCallEvent(call));

    return call;
  }

  /**
   * Update a call record by Twilio Call SID
   */
  async updateCallByTwilioSid(twilioCallSid: string, input: UpdateCallInput) {
    const call = await this.prisma.phoneCall.findUnique({
      where: { twilioCallSid },
    });

    if (!call) {
      this.logger.warn(`Call not found for SID: ${twilioCallSid}`);
      return null;
    }

    const updated = await this.prisma.phoneCall.update({
      where: { twilioCallSid },
      data: input,
    });

    this.logger.log(`Updated call ${call.id}: status=${input.status || 'unchanged'}`);

    // Emit real-time event
    this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(updated));

    return updated;
  }

  /**
   * Associate a user with a call (when they answer)
   * Also sets answeredAt if not already set
   */
  async associateUserWithCall(twilioCallSid: string, userId: string) {
    // First get the current call to check if answeredAt is set
    const call = await this.prisma.phoneCall.findUnique({
      where: { twilioCallSid },
      select: { answeredAt: true },
    });

    const updated = await this.prisma.phoneCall.update({
      where: { twilioCallSid },
      data: {
        callerId: userId,
        // Set answeredAt if not already set (the dial completed means it was answered)
        ...(call && !call.answeredAt ? { answeredAt: new Date() } : {}),
      },
    });
    this.logger.log(`Updated call ${updated.id} with callerId=${userId}, answeredAt=${updated.answeredAt}`);
    return updated;
  }

  /**
   * Get call by Twilio SID
   */
  async getCallByTwilioSid(twilioCallSid: string) {
    return this.prisma.phoneCall.findUnique({
      where: { twilioCallSid },
      include: {
        buyer: true,
        caller: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  /**
   * Get call by original Twilio SID and segment number
   * This handles the synthetic twilioCallSid format for transfer segments
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async getCallByOriginalSidAndSegment(originalCallSid: string, segmentNumber: number) {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    return this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
      include: {
        buyer: true,
        caller: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  /**
   * Get the latest/active segment of a call chain
   * When a call is transferred, we create new segments with SIDs like "original_transfer_1", etc.
   * This finds the most recent segment that should receive the "completed" status
   */
  async getLatestCallSegment(inputCallSid: string) {
    // Extract the original CallSid (in case input has _transfer_X suffix)
    const originalCallSid = inputCallSid.split('_transfer')[0];

    // Find all segments related to this call (original + all transfers)
    const allSegments = await this.prisma.phoneCall.findMany({
      where: {
        OR: [
          { twilioCallSid: originalCallSid },
          { twilioCallSid: { startsWith: `${originalCallSid}_transfer` } },
        ],
      },
      orderBy: { startedAt: 'desc' },
      include: {
        buyer: true,
        caller: { include: { user: true } },
      },
    });

    this.logger.log(`Found ${allSegments.length} segments for call ${originalCallSid}`);

    // Find the first segment that is NOT transferred (starting from most recent)
    // This is the segment that should be marked as completed
    for (const segment of allSegments) {
      if (segment.status !== 'transferred') {
        this.logger.log(`Active segment found: ${segment.twilioCallSid} with status ${segment.status}`);
        return segment;
      }
    }

    // If all segments are transferred, return the most recent one
    this.logger.log(`All segments transferred, returning most recent`);
    return allSegments[0] || null;
  }

  /**
   * Upload recording to S3 and update the call record
   * Associates recording with ALL segments of the call chain (for transfers)
   */
  async processRecording(
    twilioCallSid: string,
    twilioRecordingSid: string,
    recordingUrl: string,
    recordingDuration: number,
  ) {
    // Find all segments related to this call
    const originalCallSid = twilioCallSid.split('_transfer')[0];
    const allSegments = await this.prisma.phoneCall.findMany({
      where: {
        OR: [
          { twilioCallSid: originalCallSid },
          { twilioCallSid: { startsWith: `${originalCallSid}_transfer` } },
        ],
      },
      orderBy: { startedAt: 'asc' },
    });

    if (allSegments.length === 0) {
      this.logger.warn(`No call segments found for recording: ${twilioCallSid}`);
      return null;
    }

    this.logger.log(`Processing recording for ${allSegments.length} call segments: ${twilioCallSid}`);

    // Wait a bit for the recording to be fully available on Twilio's servers
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // Download recording from Twilio and upload to S3 (use first segment for tenant)
      const s3Url = await this.uploadRecordingToS3(
        allSegments[0].tenantId,
        originalCallSid,
        twilioRecordingSid,
        recordingUrl,
      );

      // Update ALL segments with the recording URL (so all transfer logs show the recording)
      const updatePromises = allSegments.map((segment) =>
        this.prisma.phoneCall.update({
          where: { id: segment.id },
          data: {
            twilioRecordingSid,
            recordingUrl: s3Url,
            recordingDuration,
            transcriptionStatus: segment.transcription ? segment.transcriptionStatus : 'pending',
          },
        }),
      );

      const updated = await Promise.all(updatePromises);

      this.logger.log(`Recording uploaded for ${updated.length} segments: ${s3Url}`);

      // Emit real-time events for all updated segments
      for (const segment of updated) {
        this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(segment));
      }

      // Trigger transcription in background for the LAST segment (will share with all)
      const lastSegmentSid = allSegments[allSegments.length - 1].twilioCallSid;
      if (lastSegmentSid) {
        this.transcriptionService.transcribeRecording(s3Url, lastSegmentSid).catch((err) => {
          this.logger.error(`Background transcription failed for ${lastSegmentSid}: ${err.message}`);
        });
      }

      return updated[updated.length - 1];
    } catch (error) {
      this.logger.error(`Failed to process recording for ${twilioCallSid}: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);

      // Update all segments with recording info but no URL (S3 failed)
      const updatePromises = allSegments.map((segment) =>
        this.prisma.phoneCall.update({
          where: { id: segment.id },
          data: {
            twilioRecordingSid,
            recordingDuration,
          },
        }),
      );

      const updated = await Promise.all(updatePromises);
      return updated[updated.length - 1];
    }
  }

  /**
   * Process recording for a specific segment (conference-based calls)
   * Each segment gets its own recording
   */
  async processSegmentRecording(
    twilioCallSid: string,
    segmentNumber: number,
    twilioRecordingSid: string,
    recordingUrl: string,
    recordingDuration: number,
  ) {
    // Construct the proper twilioCallSid for transfer segments
    // Original segment uses raw SID, transfer segments use ${originalCallSid}_transfer_${segmentNumber}
    const constructedCallSid = this.constructTwilioCallSid(twilioCallSid, segmentNumber);

    // Find the specific segment by constructed callSid and segmentNumber
    const segment = await this.prisma.phoneCall.findFirst({
      where: {
        twilioCallSid: constructedCallSid,
        segmentNumber,
      },
    });

    if (!segment) {
      this.logger.warn(`No segment found for call ${twilioCallSid} (constructed: ${constructedCallSid}) segment ${segmentNumber}`);
      return null;
    }

    this.logger.log(`Processing recording for segment ${segmentNumber} of call ${constructedCallSid}`);

    // Wait a bit for the recording to be fully available
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // Download recording from Twilio and upload to S3
      const s3Url = await this.uploadRecordingToS3(
        segment.tenantId,
        `${twilioCallSid}_seg${segmentNumber}`,
        twilioRecordingSid,
        recordingUrl,
      );

      // Update ONLY this segment with its recording
      const updated = await this.prisma.phoneCall.update({
        where: { id: segment.id },
        data: {
          twilioRecordingSid,
          recordingUrl: s3Url,
          recordingDuration,
          transcriptionStatus: 'pending',
        },
      });

      this.logger.log(`Segment ${segmentNumber} recording uploaded: ${s3Url}`);

      // Trigger transcription for this specific segment
      this.transcriptionService.transcribeSegmentRecording(s3Url, segment.id).catch((err) => {
        this.logger.error(`Segment transcription failed for ${segment.id}: ${err.message}`);
      });

      return updated;
    } catch (error) {
      this.logger.error(`Failed to process segment recording: ${error.message}`);

      await this.prisma.phoneCall.update({
        where: { id: segment.id },
        data: { twilioRecordingSid, recordingDuration },
      });

      return null;
    }
  }

  /**
   * Update conference information for a call segment
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async updateConferenceInfo(
    originalCallSid: string,
    segmentNumber: number,
    conferenceSid: string,
    conferenceName: string,
  ) {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    const updated = await this.prisma.phoneCall.updateMany({
      where: {
        twilioCallSid,
        segmentNumber,
      },
      data: {
        conferenceSid,
        conferenceName,
      },
    });

    this.logger.log(`Updated conference info for ${twilioCallSid} segment ${segmentNumber}: ${conferenceSid}`);
    return updated;
  }

  /**
   * Dial agent(s) into a conference when it starts
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async dialAgentIntoConference(
    originalCallSid: string,
    segmentNumber: number,
    conferenceName: string,
    tenantId: string,
  ) {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    // Get the call record with the target info
    const call = await this.prisma.phoneCall.findFirst({
      where: {
        twilioCallSid,
        segmentNumber,
      },
    });

    if (!call) {
      this.logger.warn(`Call not found for dialing agent: ${twilioCallSid} segment ${segmentNumber}`);
      return;
    }

    const metaValue = call.metaValue as any;
    const conferenceTarget = metaValue?.conferenceTarget;
    const callerId = metaValue?.conferenceCallerId || call.toNumber;
    const phoneNumberId = metaValue?.phoneNumberId;
    const stepIndex = metaValue?.stepIndex;
    const attemptIndex = metaValue?.attemptIndex;
    const dialTimeout = metaValue?.dialTimeout || 20; // Default to 20 seconds if not specified

    // For transfer segments, the agent is dialed directly from transferCall
    // Don't dial again from participant-join
    if (metaValue?.agentDialedFromTransfer) {
      this.logger.log(`Agent already dialed from transfer for ${twilioCallSid}, skipping dialAgentIntoConference`);
      return;
    }

    if (!conferenceTarget) {
      this.logger.warn(`No conference target found for call ${twilioCallSid}`);
      return;
    }

    // Parse targets (may be comma-separated for simulcall)
    const targets = conferenceTarget.split(',').map((t: string) => t.trim());

    this.logger.log(`Dialing ${targets.length} agent(s) into conference ${conferenceName} (timeout: ${dialTimeout}s)`);

    // Dial each target into the conference
    for (const target of targets) {
      try {
        await this.dialSingleAgentIntoConference(
          target,
          conferenceName,
          callerId,
          tenantId,
          originalCallSid, // Pass original SID for callback URLs
          segmentNumber,
          dialTimeout, // Use timeout from call flow config
          phoneNumberId,
          stepIndex,
          attemptIndex,
        );
      } catch (error) {
        this.logger.error(`Failed to dial agent ${target} into conference: ${error.message}`);
      }
    }
  }

  /**
   * Dial a single agent (by user ID, email, or phone) into a conference
   * Returns the agent call SID so it can be tracked and terminated if needed
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  private async dialSingleAgentIntoConference(
    target: string,
    conferenceName: string,
    callerId: string,
    tenantId: string,
    originalCallSid: string,
    segmentNumber: number,
    timeout: number = 20,
    phoneNumberId?: string,
    stepIndex?: number,
    attemptIndex?: number,
  ): Promise<string | null> {
    // Generate TwiML for joining the conference
    const twiml = this.generateJoinConferenceTwiml(conferenceName);

    // Build status callback URL to detect when agent doesn't answer
    // Include phoneId, step, and attempt for round robin retry handling
    // Use original call SID (not constructed) because that's what Twilio knows
    const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
    let statusCallback = `${baseUrl}/api/v1/twilio/voice/agent-status/${tenantId}/${originalCallSid}/${segmentNumber}`;
    if (phoneNumberId !== undefined) {
      statusCallback += `?phoneId=${phoneNumberId}`;
      if (stepIndex !== undefined) {
        statusCallback += `&step=${stepIndex}`;
      }
      if (attemptIndex !== undefined) {
        statusCallback += `&attempt=${attemptIndex}`;
      }
    }

    // Include ParentCallSid so the agent's frontend can use it for transfers
    const callOptions = {
      statusCallback,
      timeout,
      customParameters: {
        ParentCallSid: originalCallSid, // The original caller's call SID
      },
    };

    // Determine if target is a user ID (UUID), email, or phone number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
    const isEmail = target.includes('@');
    let agentCallSid: string | null = null;

    if (isUUID) {
      // Use userId directly for client identity (tenantId:userId format)
      const clientIdentity = `${tenantId}:${target}`;
      this.logger.log(`Dialing agent client ${clientIdentity} into conference ${conferenceName} (timeout: ${timeout}s, ParentCallSid: ${originalCallSid})`);

      // Create outbound call to the Twilio Client with ParentCallSid parameter
      agentCallSid = await this.twilioService.callClient(clientIdentity, callerId, twiml, callOptions);
    } else if (isEmail) {
      // Look up user ID by email to build client identity
      const user = await this.prisma.user.findFirst({
        where: { email: { equals: target, mode: 'insensitive' } },
        select: { id: true },
      });

      if (user?.id) {
        const clientIdentity = `${tenantId}:${user.id}`;
        this.logger.log(`Dialing agent client ${clientIdentity} into conference ${conferenceName} (timeout: ${timeout}s, ParentCallSid: ${originalCallSid})`);

        agentCallSid = await this.twilioService.callClient(clientIdentity, callerId, twiml, callOptions);
      } else {
        this.logger.warn(`User not found for email ${target}`);
      }
    } else {
      // Phone number - can't pass custom parameters to phone numbers
      this.logger.log(`Dialing phone ${target} into conference ${conferenceName} (timeout: ${timeout}s)`);
      agentCallSid = await this.twilioService.callNumber(target, callerId, twiml, { statusCallback, timeout });
    }

    // Store the agent call SID in the call record so we can terminate it if caller hangs up
    // Use constructed twilioCallSid for database lookup
    // Pass target as userId if it's a UUID (for SIMULCALL user identification)
    if (agentCallSid) {
      const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);
      const userId = isUUID ? target : undefined;
      await this.storeAgentCallSid(twilioCallSid, segmentNumber, agentCallSid, userId);
    }

    return agentCallSid;
  }

  /**
   * Construct the correct twilioCallSid for database queries based on segment number
   * Segment 0 uses the raw Twilio SID, transfer segments use the _transfer_N format
   */
  private constructTwilioCallSid(originalCallSid: string, segmentNumber: number): string {
    if (segmentNumber === 0) {
      return originalCallSid;
    }
    return `${originalCallSid}_transfer_${segmentNumber}`;
  }

  /**
   * Store agent call SID in the phone call record
   * Also stores the mapping of agentCallSid -> userId for SIMULCALL identification
   */
  private async storeAgentCallSid(twilioCallSid: string, segmentNumber: number, agentCallSid: string, userId?: string) {
    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
    });

    if (call) {
      const metaValue = (call.metaValue as any) || {};
      const agentCallSids = metaValue.agentCallSids || [];
      agentCallSids.push(agentCallSid);

      // Store mapping of agentCallSid -> userId for SIMULCALL identification
      const agentCallSidToUserId = metaValue.agentCallSidToUserId || {};
      if (userId) {
        agentCallSidToUserId[agentCallSid] = userId;
      }

      await this.prisma.phoneCall.update({
        where: { id: call.id },
        data: {
          metaValue: {
            ...metaValue,
            agentCallSids,
            agentCallSidToUserId,
          },
        },
      });
      this.logger.log(`Stored agent call SID ${agentCallSid} for call ${twilioCallSid}${userId ? ` (userId: ${userId})` : ''}`);
    }
  }

  /**
   * Generate TwiML for joining a conference
   */
  private generateJoinConferenceTwiml(conferenceName: string): string {
    const twilio = require('twilio');
    const response = new twilio.twiml.VoiceResponse();
    const dial = response.dial();

    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true, // When agent hangs up, end the conference (and caller's call)
        beep: false,
      },
      conferenceName,
    );

    return response.toString();
  }

  /**
   * Handle agent joining a conference - associate user with call
   * For SIMULCALL: terminates other pending agent calls since one already answered
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async handleAgentJoinedConference(
    originalCallSid: string,
    segmentNumber: number,
    agentCallSid: string,
  ) {
    // Construct the correct twilioCallSid for database lookup
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    // Get the call to find out which user answered
    // For initial calls (segment 0), we might need to query without segmentNumber if it wasn't set
    let call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
    });

    // Fallback: if not found and segment is 0, try without segmentNumber filter
    // This handles the case where the record exists but segmentNumber wasn't updated yet
    if (!call && segmentNumber === 0) {
      call = await this.prisma.phoneCall.findFirst({
        where: { twilioCallSid },
      });
      if (call) {
        this.logger.log(`handleAgentJoinedConference: Found call without segmentNumber filter`);
      }
    }

    if (!call) {
      this.logger.warn(`Call not found for agent join: ${twilioCallSid} segment ${segmentNumber}`);
      return { count: 0 };
    }

    const metaValue = (call.metaValue as any) || {};
    let conferenceTarget = metaValue.conferenceTarget;

    this.logger.log(`handleAgentJoinedConference: callSid=${twilioCallSid}, metaValue=${JSON.stringify(metaValue)}, conferenceTarget=${conferenceTarget}`);

    // Try to identify the TenantUser who answered
    let answeringTenantUserId: string | null = null;

    // If no conferenceTarget in metaValue, try to get it from the call flow configuration
    if (!conferenceTarget && metaValue.phoneNumberId && metaValue.stepIndex !== undefined) {
      this.logger.log(`No conferenceTarget in metaValue, trying to get from call flow config`);
      try {
        const phoneNumber = await this.prisma.twilioPhoneNumber.findUnique({
          where: { id: metaValue.phoneNumberId },
          include: { callFlow: true },
        });

        if (phoneNumber?.callFlow?.steps) {
          const steps = phoneNumber.callFlow.steps as any[];
          const step = steps[metaValue.stepIndex];
          if (step) {
            if (step.type === 'dial' && step.config?.destination) {
              conferenceTarget = step.config.destination;
              this.logger.log(`Got conferenceTarget from call flow DIAL step: ${conferenceTarget}`);
            } else if (step.type === 'simulcall' && step.config?.destinations?.length === 1) {
              conferenceTarget = step.config.destinations[0];
              this.logger.log(`Got conferenceTarget from call flow SIMULCALL step: ${conferenceTarget}`);
            } else if (step.type === 'round_robin' && step.config?.destinations) {
              const attemptIndex = metaValue.attemptIndex || 0;
              if (step.config.destinations[attemptIndex]) {
                conferenceTarget = step.config.destinations[attemptIndex];
                this.logger.log(`Got conferenceTarget from call flow ROUND_ROBIN step: ${conferenceTarget}`);
              }
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to get conferenceTarget from call flow: ${err.message}`);
      }
    }

    if (conferenceTarget) {
      // Check if it's a single target (no comma = single user)
      const targets = conferenceTarget.split(',').map((t: string) => t.trim());

      this.logger.log(`Targets parsed: ${JSON.stringify(targets)}, count=${targets.length}`);

      if (targets.length === 1) {
        // Single target - use it directly
        const target = targets[0];
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);

        this.logger.log(`Single target: ${target}, isUUID=${isUUID}, isEmail=${target.includes('@')}`);

        if (isUUID) {
          // It's a User ID - find the TenantUser
          const tenantUser = await this.prisma.tenantUser.findFirst({
            where: {
              tenantId: call.tenantId,
              user: { id: target },
            },
          });
          this.logger.log(`TenantUser lookup by user.id=${target}: ${tenantUser ? `found id=${tenantUser.id}` : 'NOT FOUND'}`);
          if (tenantUser) {
            answeringTenantUserId = tenantUser.id;
          }
        } else if (target.includes('@')) {
          // It's an email - find the TenantUser
          const tenantUser = await this.prisma.tenantUser.findFirst({
            where: {
              tenantId: call.tenantId,
              user: { email: target },
            },
          });
          this.logger.log(`TenantUser lookup by email=${target}: ${tenantUser ? `found id=${tenantUser.id}` : 'NOT FOUND'}`);
          if (tenantUser) {
            answeringTenantUserId = tenantUser.id;
          }
        } else {
          this.logger.warn(`Target ${target} is neither UUID nor email - cannot identify user`);
        }
      } else {
        // SIMULCALL - multiple targets, check agentCallSidToUser mapping if available
        const agentMapping = metaValue.agentCallSidToUserId || {};
        this.logger.log(`SIMULCALL: agentMapping=${JSON.stringify(agentMapping)}, agentCallSid=${agentCallSid}`);
        if (agentMapping[agentCallSid]) {
          // We have a mapping for this specific agent call
          const userId = agentMapping[agentCallSid];
          const tenantUser = await this.prisma.tenantUser.findFirst({
            where: {
              tenantId: call.tenantId,
              user: { id: userId },
            },
          });
          if (tenantUser) {
            answeringTenantUserId = tenantUser.id;
          }
        }
      }
    } else {
      this.logger.warn(`No conferenceTarget found in metaValue for call ${twilioCallSid}`);
    }

    // Update the call status to in-progress and set the caller if identified
    const updateData: any = {
      status: 'in-progress',
      answeredAt: new Date(),
    };

    if (answeringTenantUserId) {
      updateData.callerId = answeringTenantUserId;
      this.logger.log(`Setting callerId to ${answeringTenantUserId} for call ${twilioCallSid}`);
    }

    const updatedCall = await this.prisma.phoneCall.update({
      where: { id: call.id },
      data: updateData,
    });

    // Emit real-time event for call answered
    this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(updatedCall));

    this.logger.log(`Agent ${agentCallSid} joined conference for ${twilioCallSid} segment ${segmentNumber}`);

    // For SIMULCALL: terminate other pending agent calls since one already answered
    const agentCallSids: string[] = metaValue.agentCallSids || [];

    // Find other agent calls that are still pending (not the one that just joined)
    const otherAgentCalls = agentCallSids.filter((sid: string) => sid !== agentCallSid);

    if (otherAgentCalls.length > 0) {
      this.logger.log(`Terminating ${otherAgentCalls.length} other agent call(s) for SIMULCALL`);

      for (const otherCallSid of otherAgentCalls) {
        try {
          await this.twilioService.hangupCall(otherCallSid);
          this.logger.log(`Terminated other agent call ${otherCallSid}`);
        } catch (error) {
          // Call might already be completed or not exist
          this.logger.warn(`Could not terminate other agent call ${otherCallSid}: ${error.message}`);
        }
      }

      // Update agentCallSids to only keep the one that answered
      await this.prisma.phoneCall.update({
        where: { id: call.id },
        data: {
          metaValue: {
            ...metaValue,
            agentCallSids: [agentCallSid],
          },
        },
      });
    }

    return { count: 1 };
  }

  /**
   * Terminate pending agent calls when caller hangs up
   * This is called when the conference ends or when the caller leaves
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async terminatePendingAgentCalls(originalCallSid: string, segmentNumber: number) {
    // Construct the correct twilioCallSid for database lookup
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
    });

    if (!call) {
      this.logger.warn(`Call not found for terminating agent calls: ${twilioCallSid} (original: ${originalCallSid}, segment: ${segmentNumber})`);
      return;
    }

    const metaValue = call.metaValue as any;
    const agentCallSids = metaValue?.agentCallSids || [];

    if (agentCallSids.length === 0) {
      this.logger.log(`No pending agent calls to terminate for ${twilioCallSid}`);
      return;
    }

    this.logger.log(`Terminating ${agentCallSids.length} pending agent call(s) for ${twilioCallSid}`);

    for (const agentCallSid of agentCallSids) {
      try {
        await this.twilioService.hangupCall(agentCallSid);
        this.logger.log(`Terminated agent call ${agentCallSid}`);
      } catch (error) {
        // Call might already be completed or not exist
        this.logger.warn(`Could not terminate agent call ${agentCallSid}: ${error.message}`);
      }
    }

    // Clear the agent call SIDs from metaValue
    await this.prisma.phoneCall.update({
      where: { id: call.id },
      data: {
        metaValue: {
          ...metaValue,
          agentCallSids: [],
        },
      },
    });
  }

  /**
   * Check if a call was answered (agent joined the conference)
   * Used to determine if we should continue round robin or end the call
   */
  async wasCallAnswered(twilioCallSid: string): Promise<boolean> {
    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid },
      select: { status: true, answeredAt: true },
    });

    if (!call) {
      return false;
    }

    // Call was answered if status is 'in-progress' or 'completed' or has an answeredAt timestamp
    const wasAnswered = call.status === 'in-progress' ||
                        call.status === 'completed' ||
                        call.answeredAt !== null;

    this.logger.log(`wasCallAnswered(${twilioCallSid}): status=${call.status}, answeredAt=${call.answeredAt}, result=${wasAnswered}`);
    return wasAnswered;
  }

  /**
   * Terminate the caller's call when an agent hangs up
   * This ensures the caller's call ends when the agent disconnects
   */
  async terminateCallerCall(twilioCallSid: string) {
    this.logger.log(`Terminating caller call: ${twilioCallSid}`);
    try {
      await this.twilioService.hangupCall(twilioCallSid);
      this.logger.log(`Caller call terminated: ${twilioCallSid}`);
    } catch (error) {
      // Call might already be completed
      this.logger.warn(`Could not terminate caller call ${twilioCallSid}: ${error.message}`);
    }
  }

  /**
   * Redirect the caller's call to new TwiML
   * Used to redirect to next round robin attempt when agent doesn't answer
   */
  async redirectCallerCall(twilioCallSid: string, twiml: string) {
    this.logger.log(`Redirecting caller call: ${twilioCallSid}`);
    try {
      await this.twilioService.updateCallTwiml(twilioCallSid, twiml);
      this.logger.log(`Caller call redirected: ${twilioCallSid}`);
    } catch (error) {
      this.logger.warn(`Could not redirect caller call ${twilioCallSid}: ${error.message}`);
    }
  }

  /**
   * Handle agent call status - called when agent's outbound call ends
   * If agent didn't answer (no-answer, busy, failed), we may need to redirect caller
   * Returns true if the call was answered, false if not
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async handleAgentCallStatus(
    originalCallSid: string,
    segmentNumber: number,
    agentCallSid: string,
    callStatus: string,
  ): Promise<boolean> {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);
    this.logger.log(`Agent call status: ${agentCallSid} -> ${callStatus} (caller: ${twilioCallSid}, segment: ${segmentNumber})`);

    // Check if the call was answered
    const wasAnswered = callStatus === 'completed' || callStatus === 'in-progress';

    if (!wasAnswered) {
      // Agent didn't answer - check if this was the last agent being called
      // If so, we need to move to the next round robin attempt or end the call
      this.logger.log(`Agent call ${agentCallSid} was not answered (status: ${callStatus})`);

      // Remove this agent call SID from the list since the call ended
      await this.removeAgentCallSid(originalCallSid, segmentNumber, agentCallSid);

      // Check if there are any other pending agent calls
      const call = await this.prisma.phoneCall.findFirst({
        where: { twilioCallSid, segmentNumber },
      });

      if (call) {
        const metaValue = call.metaValue as any;
        const remainingAgents = metaValue?.agentCallSids || [];

        if (remainingAgents.length === 0) {
          // No more agents being called - the caller needs to be redirected
          // This will be handled by marking a flag that the next round robin should be tried
          this.logger.log(`No more pending agent calls for ${twilioCallSid}, caller should be redirected`);

          // Mark that this conference attempt failed
          await this.prisma.phoneCall.update({
            where: { id: call.id },
            data: {
              metaValue: {
                ...metaValue,
                conferenceAttemptFailed: true,
              },
            },
          });
        }
      }
    } else {
      this.logger.log(`Agent call ${agentCallSid} was answered`);
    }

    return wasAnswered;
  }

  /**
   * Remove an agent call SID from the list
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  private async removeAgentCallSid(originalCallSid: string, segmentNumber: number, agentCallSid: string) {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
    });

    if (call) {
      const metaValue = (call.metaValue as any) || {};
      const agentCallSids = (metaValue.agentCallSids || []).filter((sid: string) => sid !== agentCallSid);

      await this.prisma.phoneCall.update({
        where: { id: call.id },
        data: {
          metaValue: {
            ...metaValue,
            agentCallSids,
          },
        },
      });
      this.logger.log(`Removed agent call SID ${agentCallSid} from call ${twilioCallSid}`);
    }
  }

  /**
   * Check if the conference attempt failed (all agents timed out)
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async didConferenceAttemptFail(originalCallSid: string, segmentNumber: number): Promise<boolean> {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
    });

    if (!call) {
      return false;
    }

    const metaValue = call.metaValue as any;
    return metaValue?.conferenceAttemptFailed === true;
  }

  /**
   * Clear the conference attempt failed flag
   * @param originalCallSid - The original Twilio call SID (without _transfer suffix)
   * @param segmentNumber - The segment number (0 for original, 1+ for transfers)
   */
  async clearConferenceAttemptFailed(originalCallSid: string, segmentNumber: number) {
    const twilioCallSid = this.constructTwilioCallSid(originalCallSid, segmentNumber);

    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid, segmentNumber },
    });

    if (call) {
      const metaValue = (call.metaValue as any) || {};
      delete metaValue.conferenceAttemptFailed;

      await this.prisma.phoneCall.update({
        where: { id: call.id },
        data: { metaValue },
      });
    }
  }

  /**
   * Update transcription for a call
   * For calls with transfers, segments each call's portion of the transcription
   * based on the time range of each segment
   */
  async updateTranscription(twilioCallSid: string, transcription: string, status: string) {
    // Find all segments related to this call
    const originalCallSid = twilioCallSid.split('_transfer')[0];
    const allSegments = await this.prisma.phoneCall.findMany({
      where: {
        OR: [
          { twilioCallSid: originalCallSid },
          { twilioCallSid: { startsWith: `${originalCallSid}_transfer` } },
        ],
      },
      orderBy: { startedAt: 'asc' },
    });

    if (allSegments.length === 0) {
      // Fallback to single update if no segments found
      const updated = await this.prisma.phoneCall.update({
        where: { twilioCallSid },
        data: { transcription, transcriptionStatus: status },
      });
      this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(updated));
      return updated;
    }

    // If only one segment, no need to split
    if (allSegments.length === 1) {
      const updated = await this.prisma.phoneCall.update({
        where: { id: allSegments[0].id },
        data: { transcription, transcriptionStatus: status },
      });
      this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(updated));
      return updated;
    }

    // Parse transcription to extract segments with timestamps
    let parsedTranscription: {
      text: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string; speaker: string }>;
    } | null = null;

    try {
      parsedTranscription = JSON.parse(transcription);
    } catch {
      this.logger.warn(`Could not parse transcription as JSON, applying to all segments`);
      // If not JSON, apply full transcription to all segments
      const updatePromises = allSegments.map((segment) =>
        this.prisma.phoneCall.update({
          where: { id: segment.id },
          data: { transcription, transcriptionStatus: status },
        }),
      );
      const updated = await Promise.all(updatePromises);
      // Emit real-time events for all updated segments
      for (const segment of updated) {
        this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(segment));
      }
      return updated[updated.length - 1];
    }

    // Calculate the call start time (first segment's start)
    const callStartTime = allSegments[0].startedAt?.getTime() || 0;

    // Segment the transcription for each call segment
    const updatePromises = allSegments.map((segment, index) => {
      // Calculate time range for this segment (relative to call start, in seconds)
      const segmentStartTime = segment.startedAt?.getTime() || callStartTime;
      const segmentEndTime = segment.endedAt?.getTime() || Date.now();

      // Convert to seconds relative to call start
      const segmentStartOffset = Math.max(0, (segmentStartTime - callStartTime) / 1000);
      const segmentEndOffset = (segmentEndTime - callStartTime) / 1000;

      this.logger.log(
        `Segment ${index} (${segment.twilioCallSid}): ${segmentStartOffset.toFixed(1)}s - ${segmentEndOffset.toFixed(1)}s`,
      );

      // Filter transcription segments that fall within this time range
      let segmentTranscription: string;

      if (parsedTranscription?.segments && parsedTranscription.segments.length > 0) {
        const filteredSegments = parsedTranscription.segments.filter((ts) => {
          // Include segment if it overlaps with this call segment's time range
          return ts.start < segmentEndOffset && ts.end > segmentStartOffset;
        });

        // Adjust timestamps to be relative to this segment's start
        const adjustedSegments = filteredSegments.map((ts) => ({
          ...ts,
          start: Math.max(0, ts.start - segmentStartOffset),
          end: ts.end - segmentStartOffset,
        }));

        // Build the filtered transcription
        const filteredText = filteredSegments.map((s) => s.text).join(' ');
        const segmentDuration = segmentEndOffset - segmentStartOffset;

        segmentTranscription = JSON.stringify({
          text: filteredText,
          duration: segmentDuration,
          segments: adjustedSegments,
        });

        this.logger.log(
          `Segment ${index}: ${filteredSegments.length} transcription segments (of ${parsedTranscription.segments.length} total)`,
        );
      } else {
        // No detailed segments, use full transcription for all
        segmentTranscription = transcription;
      }

      return this.prisma.phoneCall.update({
        where: { id: segment.id },
        data: { transcription: segmentTranscription, transcriptionStatus: status },
      });
    });

    const updated = await Promise.all(updatePromises);
    this.logger.log(`Transcription segmented for ${updated.length} call segments`);

    // Emit real-time events for all updated segments
    for (const segment of updated) {
      this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(segment));
    }

    return updated[updated.length - 1];
  }

  /**
   * Find buyer by phone number
   * Searches across phoneMain, phoneSecondary, and phoneMobile fields
   * Handles both E.164 format (+1xxxxxxxxxx) and UI format ((xxx) xxx-xxxx)
   */
  private async findBuyerByPhone(tenantId: string, phoneNumber: string): Promise<string | null> {
    if (!phoneNumber) {
      this.logger.warn(`findBuyerByPhone: No phone number provided`);
      return null;
    }

    const normalized = normalizePhoneNumber(phoneNumber);

    // Extract digits for fallback matching (handles both E.164 and UI formats)
    const digits = phoneNumber.replace(/\D/g, '');
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

    this.logger.log(`findBuyerByPhone: input="${phoneNumber}", normalized="${normalized}", last10="${last10}", tenantId="${tenantId}"`);

    if (!normalized && !last10) {
      this.logger.warn(`findBuyerByPhone: Could not normalize or extract digits from: ${phoneNumber}`);
      return null;
    }

    // Build OR conditions
    const orConditions: any[] = [];

    if (normalized) {
      // Match E.164 format (preferred)
      orConditions.push({ phoneMain: normalized });
      orConditions.push({ phoneSecondary: normalized });
      orConditions.push({ phoneMobile: normalized });
    }

    if (last10 && last10.length === 10) {
      // Fallback: match last 10 digits (handles non-normalized DB entries)
      orConditions.push({ phoneMain: { endsWith: last10 } });
      orConditions.push({ phoneSecondary: { endsWith: last10 } });
      orConditions.push({ phoneMobile: { endsWith: last10 } });
    }

    if (orConditions.length === 0) {
      this.logger.warn(`findBuyerByPhone: No valid search conditions for: ${phoneNumber}`);
      return null;
    }

    const buyer = await this.prisma.buyer.findFirst({
      where: {
        tenantId,
        OR: orConditions,
      },
      select: { id: true, phoneMain: true, phoneSecondary: true, phoneMobile: true },
    });

    if (buyer) {
      this.logger.log(`findBuyerByPhone: Found buyer ${buyer.id} for phone ${phoneNumber} (buyerPhones: main=${buyer.phoneMain}, secondary=${buyer.phoneSecondary}, mobile=${buyer.phoneMobile})`);
      return buyer.id;
    } else {
      this.logger.log(`findBuyerByPhone: No buyer found for phone ${phoneNumber} in tenant ${tenantId}`);
      return null;
    }
  }

  /**
   * Normalize phone number to E.164 format
   * Uses the shared utility function
   */
  private normalizePhone(phone: string): string {
    return normalizePhoneNumber(phone) || phone;
  }

  /**
   * Upload recording from Twilio to S3
   */
  private async uploadRecordingToS3(
    tenantId: string,
    callSid: string,
    recordingSid: string,
    twilioUrl: string,
  ): Promise<string> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }

    // Build the recording URL using the Recording SID directly
    // This is more reliable than using the callback URL
    const fullUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;

    this.logger.log(`Downloading recording from Twilio: ${fullUrl}`);
    this.logger.log(`Using Account SID: ${accountSid.substring(0, 10)}...`);

    // Use Basic Auth with Twilio credentials
    const authString = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Download the recording with proper authentication
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
      },
    });

    this.logger.log(`Twilio response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      this.logger.error(`Failed to download recording: ${response.status} ${response.statusText}`);
      this.logger.error(`Response body: ${errorText.substring(0, 500)}`);
      throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    this.logger.log(`Downloaded recording, size: ${buffer.length} bytes`);

    if (buffer.length === 0) {
      throw new Error('Downloaded recording is empty');
    }

    // Upload to S3
    const folder = `tenants/${tenantId}/recordings/${callSid}`;
    const result = await this.s3Service.uploadBuffer(buffer, folder, 'mp3', 'audio/mpeg');

    this.logger.log(`Uploaded recording to S3: ${result.url}`);

    return result.url;
  }

  /**
   * Get calls for a tenant with pagination
   */
  async getCallsForTenant(
    tenantId: string,
    options: {
      page?: number;
      limit?: number;
      direction?: string;
      buyerId?: string;
      callerId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ) {
    const { page = 1, limit = 20, direction, buyerId, callerId, startDate, endDate } = options;

    const where: any = { tenantId };

    if (direction) where.direction = direction;
    if (buyerId) where.buyerId = buyerId;
    if (callerId) where.callerId = callerId;
    if (startDate || endDate) {
      where.startedAt = {};
      if (startDate) where.startedAt.gte = startDate;
      if (endDate) where.startedAt.lte = endDate;
    }

    const [calls, total] = await Promise.all([
      this.prisma.phoneCall.findMany({
        where,
        include: {
          buyer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneMain: true,
            },
          },
          caller: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          transferredTo: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          transferredFrom: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.phoneCall.count({ where }),
    ]);

    return {
      data: calls,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get calls for a specific buyer
   */
  async getCallsForBuyer(tenantId: string, buyerId: string) {
    return this.prisma.phoneCall.findMany({
      where: { tenantId, buyerId },
      include: {
        caller: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        transferredTo: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        transferredFrom: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Transfer an active call to another user using conference-based approach
   * Creates a new conference for each transfer segment with separate recording
   * @param twilioCallSid - The Twilio Call SID of the active call (can be caller's or agent's SID)
   * @param transferToUserId - The TenantUser ID to transfer to
   * @param transferFromUserId - The TenantUser ID who is transferring
   * @param reason - Optional reason for the transfer
   */
  async transferCall(
    twilioCallSid: string,
    transferToUserId: string,
    transferFromUserId: string,
    reason?: string,
  ) {
    this.logger.log(`Transfer request: callSid=${twilioCallSid}, transferTo=${transferToUserId}, transferFrom=${transferFromUserId}`);

    // Find the ACTIVE segment for this call (may be original or a transfer segment)
    let activeSegment = await this.getLatestCallSegment(twilioCallSid);

    // If not found, check if the callSid is actually an agent's call SID
    // The frontend might send the agent's call SID instead of the caller's
    if (!activeSegment) {
      this.logger.log(`Call not found by SID ${twilioCallSid}, searching in agentCallSids...`);

      // Search for a call that has this SID in its agentCallSids array
      const callWithAgent = await this.prisma.phoneCall.findFirst({
        where: {
          status: 'in-progress', // Only active calls
          metaValue: {
            path: ['agentCallSids'],
            array_contains: twilioCallSid,
          },
        },
        orderBy: { startedAt: 'desc' },
        include: {
          buyer: true,
          caller: { include: { user: true } },
        },
      });

      if (callWithAgent) {
        this.logger.log(`Found call ${callWithAgent.twilioCallSid} containing agent SID ${twilioCallSid}`);
        activeSegment = callWithAgent;
      }
    }

    if (!activeSegment) {
      throw new BadRequestException('Call not found');
    }

    // Get full call data with tenant
    const call = await this.prisma.phoneCall.findUnique({
      where: { id: activeSegment.id },
      include: { tenant: true },
    });

    if (!call) {
      throw new BadRequestException('Call not found');
    }

    // Use the caller's call SID from the database record, not the parameter
    // (parameter might be agent's call SID if frontend doesn't have caller's SID)
    const callerCallSid = call.twilioCallSid;

    this.logger.log(`Transferring call segment: ${callerCallSid} (requested: ${twilioCallSid})`);

    // Allow transfer for calls that are not in a terminal state
    const terminalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'transferred'];
    if (terminalStatuses.includes(call.status)) {
      throw new BadRequestException(`Cannot transfer call with status: ${call.status}`);
    }

    // Get the target user's information
    const targetUser = await this.prisma.tenantUser.findUnique({
      where: { id: transferToUserId },
      include: {
        user: true,
        twilioPhoneNumber: true,
      },
    });

    if (!targetUser) {
      throw new BadRequestException('Target user not found');
    }

    // Extract the original CallSid (without _transfer_X suffix) from the CALLER's call SID
    const originalCallSid = callerCallSid ? callerCallSid.split('_transfer')[0] : null;

    if (!originalCallSid) {
      throw new BadRequestException('Original call SID not found');
    }

    // Calculate new segment number
    const currentSegmentNumber = call.segmentNumber || 0;
    const newSegmentNumber = currentSegmentNumber + 1;

    // Get caller ID (use the original called number as caller ID)
    const callerId = call.direction === 'inbound' ? call.toNumber : call.fromNumber;

    // Generate new conference name for the transfer segment
    const newConferenceName = `call_${originalCallSid}_seg_${newSegmentNumber}`;

    // Calculate duration for current segment
    const now = new Date();
    const startTime = call.answeredAt || call.startedAt;
    const segmentDuration = startTime ? Math.floor((now.getTime() - startTime.getTime()) / 1000) : null;

    this.logger.log(`Segment duration: ${segmentDuration}s. Creating new conference: ${newConferenceName}`);

    // 1. Update the ACTIVE SEGMENT to 'transferred' status
    const updatedCall = await this.prisma.phoneCall.update({
      where: { id: call.id },
      data: {
        status: 'transferred',
        endedAt: now,
        duration: segmentDuration,
        transferredAt: now,
        transferredToUserId: transferToUserId,
        transferredFromUserId: transferFromUserId,
        transferReason: reason,
      },
      include: {
        transferredTo: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        transferredFrom: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
    });

    this.logger.log(`Transfer saved: transferredTo=${updatedCall.transferredTo?.user?.email || 'null'}, transferredFrom=${updatedCall.transferredFrom?.user?.email || 'null'}`);

    // Emit real-time event for the transferred call
    this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(updatedCall));

    // 2. Create a NEW call record for the transfer segment
    const newCallSid = `${originalCallSid}_transfer_${newSegmentNumber}`;

    const newCallRecord = await this.prisma.phoneCall.create({
      data: {
        tenantId: call.tenantId,
        twilioCallSid: newCallSid,
        direction: call.direction,
        fromNumber: call.fromNumber,
        toNumber: call.toNumber,
        status: 'ringing',
        callerId: transferToUserId,
        buyerId: call.buyerId,
        startedAt: new Date(),
        segmentNumber: newSegmentNumber,
        conferenceName: newConferenceName,
        parentCallId: call.parentCallId || call.id,
        metaValue: {
          conferenceTarget: targetUser.user.id,
          conferenceCallerId: callerId,
          // Mark that agent will be dialed from transferCall directly
          // This prevents dialAgentIntoConference from dialing again on participant-join
          agentDialedFromTransfer: true,
        },
      },
    });

    this.logger.log(`Created new transfer segment: ${newCallSid}, segment ${newSegmentNumber}`);

    // Emit real-time event for the new transfer segment
    this.phoneCallEventsService.emitCallCreated(await this.toCallEvent(newCallRecord));

    // 3. Redirect the caller to the new conference
    // Generate TwiML for the new conference
    const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
    const shouldRecord = true; // Always record transfers

    const transferTwiml = this.generateTransferConferenceTwiml(
      newConferenceName,
      call.tenantId,
      originalCallSid,
      newSegmentNumber,
      shouldRecord,
      baseUrl,
    );

    // Update the original call to redirect to new conference
    await this.twilioService.updateCallTwiml(originalCallSid, transferTwiml);

    // 4. Dial the new agent into the conference
    // Use tenantId:userId format for client identity
    const clientIdentity = `${call.tenantId}:${targetUser.user.id}`;
    const agentTwiml = this.generateJoinConferenceTwiml(newConferenceName);

    try {
      // Build status callback URL for agent call status tracking
      // Use originalCallSid (not newCallSid) because the webhook handler uses constructTwilioCallSid
      // to build the full twilioCallSid from the original SID + segment number
      const agentStatusCallback = `${baseUrl}/api/v1/twilio/voice/agent-status/${call.tenantId}/${originalCallSid}/${newSegmentNumber}`;

      const newAgentCallSid = await this.twilioService.callClient(clientIdentity, callerId, agentTwiml, {
        statusCallback: agentStatusCallback,
        customParameters: {
          ParentCallSid: originalCallSid, // Pass original caller's SID for future transfers
        },
      });
      this.logger.log(`Dialed agent ${clientIdentity} into conference ${newConferenceName}, agentCallSid: ${newAgentCallSid}`);

      // Store the new agent's call SID so subsequent transfers can find this call
      if (newAgentCallSid) {
        await this.storeAgentCallSid(newCallSid, newSegmentNumber, newAgentCallSid, targetUser.user.id);
      }
    } catch (error) {
      this.logger.error(`Failed to dial agent: ${error.message}`);
      // Update the new segment to failed status
      const failedRecord = await this.prisma.phoneCall.update({
        where: { id: newCallRecord.id },
        data: { status: 'failed' },
      });
      // Emit real-time event for the failed transfer segment
      this.phoneCallEventsService.emitCallUpdated(await this.toCallEvent(failedRecord));
      throw new BadRequestException('Failed to connect to agent');
    }

    this.logger.log(
      `Call ${twilioCallSid} transferred from user ${transferFromUserId} to user ${transferToUserId}. New segment: ${newCallSid}`,
    );

    return updatedCall;
  }

  /**
   * Generate TwiML for transferring caller to a new conference
   */
  private generateTransferConferenceTwiml(
    conferenceName: string,
    tenantId: string,
    callSid: string,
    segmentNumber: number,
    shouldRecord: boolean,
    baseUrl: string,
  ): string {
    const twilio = require('twilio');
    const response = new twilio.twiml.VoiceResponse();

    // Brief announcement
    response.say({ voice: 'Polly.Joanna' }, 'Please hold while we connect you.');

    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${baseUrl}/api/v1/twilio/voice/conference/${tenantId}/${callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    if (shouldRecord) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${baseUrl}/api/v1/twilio/voice/recording/${tenantId}/${callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
    }

    const dial = response.dial();
    dial.conference(conferenceOptions, conferenceName);

    return response.toString();
  }

  /**
   * Get available users for transfer in a tenant
   * Returns active users with their online status
   */
  async getAvailableTransferTargets(tenantId: string, excludeUserId?: string) {
    const users = await this.prisma.tenantUser.findMany({
      where: {
        tenantId,
        isActive: true,
        status: 'active',
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        },
        role: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      orderBy: {
        user: {
          firstName: 'asc',
        },
      },
    });

    return users.map((tu) => ({
      id: tu.id,
      name: [tu.user.firstName, tu.user.lastName].filter(Boolean).join(' ') || tu.user.email,
      email: tu.user.email,
      avatar: tu.user.avatar,
      role: tu.role.name,
      extension: tu.extension,
    }));
  }

  /**
   * Re-segment transcription for an existing call chain with transfers
   * This is useful for fixing calls that were processed before the segmentation logic
   * @param twilioCallSid - Any CallSid in the chain (original or transfer segment)
   */
  async resegmentTranscription(twilioCallSid: string): Promise<number> {
    const originalCallSid = twilioCallSid.split('_transfer')[0];

    // Find the completed segment (the one with the full transcription)
    const completedSegment = await this.prisma.phoneCall.findFirst({
      where: {
        OR: [
          { twilioCallSid: originalCallSid },
          { twilioCallSid: { startsWith: `${originalCallSid}_transfer` } },
        ],
        status: 'completed',
        transcription: { not: null },
      },
    });

    if (!completedSegment?.transcription) {
      this.logger.warn(`No completed segment with transcription found for ${twilioCallSid}`);
      return 0;
    }

    // Re-apply the transcription using the segmentation logic
    await this.updateTranscription(
      completedSegment.twilioCallSid!,
      completedSegment.transcription,
      'completed',
    );

    // Count how many segments were updated
    const count = await this.prisma.phoneCall.count({
      where: {
        OR: [
          { twilioCallSid: originalCallSid },
          { twilioCallSid: { startsWith: `${originalCallSid}_transfer` } },
        ],
      },
    });

    this.logger.log(`Re-segmented transcription for ${count} call segments`);
    return count;
  }

  /**
   * Re-segment transcriptions for all calls with transfers in a tenant
   * @param tenantId - Tenant ID to process
   */
  async resegmentAllTranscriptionsForTenant(tenantId: string): Promise<{ processed: number; errors: number }> {
    // Find all original calls (not transfers) that have transfers
    const callsWithTransfers = await this.prisma.phoneCall.findMany({
      where: {
        tenantId,
        twilioCallSid: {
          not: { contains: '_transfer' },
        },
        transcription: { not: null },
      },
      select: { twilioCallSid: true },
    });

    let processed = 0;
    let errors = 0;

    for (const call of callsWithTransfers) {
      if (!call.twilioCallSid) continue;

      // Check if this call has any transfer segments
      const transferCount = await this.prisma.phoneCall.count({
        where: {
          twilioCallSid: { startsWith: `${call.twilioCallSid}_transfer` },
        },
      });

      if (transferCount > 0) {
        try {
          await this.resegmentTranscription(call.twilioCallSid);
          processed++;
        } catch (err) {
          this.logger.error(`Failed to re-segment ${call.twilioCallSid}: ${err.message}`);
          errors++;
        }
      }
    }

    this.logger.log(`Re-segmented transcriptions: ${processed} processed, ${errors} errors`);
    return { processed, errors };
  }
}
