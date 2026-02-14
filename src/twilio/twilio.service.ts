import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Twilio } from 'twilio';
import { jwt } from 'twilio';

export interface AvailablePhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
}

export interface PurchasedPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
}

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio;

  constructor() {
    // Support both API Key auth and Account SID/Auth Token auth
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_SID;
    const apiKeySecret = process.env.TWILIO_SECRET;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && apiKeySid && apiKeySecret) {
      // API Key authentication (more secure for production)
      this.client = new Twilio(apiKeySid, apiKeySecret, { accountSid });
      this.logger.log('Twilio initialized with API Key authentication');
    } else if (accountSid && authToken) {
      // Account SID + Auth Token authentication
      this.client = new Twilio(accountSid, authToken);
      this.logger.log('Twilio initialized with Account SID authentication');
    } else {
      this.logger.warn(
        'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID + (TWILIO_SID & TWILIO_SECRET) or (TWILIO_AUTH_TOKEN)',
      );
    }
  }

  private ensureClient() {
    if (!this.client) {
      throw new BadRequestException(
        'Twilio is not configured. Please set TWILIO_ACCOUNT_SID + (TWILIO_SID & TWILIO_SECRET) or TWILIO_AUTH_TOKEN.',
      );
    }
  }

  /**
   * Search for available phone numbers by US state
   */
  async searchByState(state: string, limit = 10): Promise<AvailablePhoneNumber[]> {
    this.ensureClient();

    try {
      const numbers = await this.client.availablePhoneNumbers('US')
        .local.list({
          inRegion: state.toUpperCase(),
          voiceEnabled: true,
          smsEnabled: true,
          limit,
        });

      return numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        postalCode: n.postalCode,
        capabilities: {
          voice: n.capabilities.voice,
          sms: n.capabilities.sms,
          mms: n.capabilities.mms,
        },
      }));
    } catch (error) {
      this.logger.error(`Error searching numbers by state: ${error.message}`);
      throw new BadRequestException(`Failed to search numbers: ${error.message}`);
    }
  }

  /**
   * Search for available phone numbers by area code
   */
  async searchByAreaCode(areaCode: string, limit = 10): Promise<AvailablePhoneNumber[]> {
    this.ensureClient();

    // Validate area code format
    if (!/^\d{3}$/.test(areaCode)) {
      throw new BadRequestException('Area code must be 3 digits');
    }

    try {
      const numbers = await this.client.availablePhoneNumbers('US')
        .local.list({
          areaCode: parseInt(areaCode, 10),
          voiceEnabled: true,
          smsEnabled: true,
          limit,
        });

      return numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        postalCode: n.postalCode,
        capabilities: {
          voice: n.capabilities.voice,
          sms: n.capabilities.sms,
          mms: n.capabilities.mms,
        },
      }));
    } catch (error) {
      this.logger.error(`Error searching numbers by area code: ${error.message}`);
      throw new BadRequestException(`Failed to search numbers: ${error.message}`);
    }
  }

  /**
   * Search for available toll-free phone numbers
   */
  async searchTollFree(limit = 10): Promise<AvailablePhoneNumber[]> {
    this.ensureClient();

    try {
      const numbers = await this.client.availablePhoneNumbers('US')
        .tollFree.list({
          voiceEnabled: true,
          smsEnabled: true,
          limit,
        });

      return numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: null, // Toll-free numbers don't have locality
        region: null,
        postalCode: null,
        capabilities: {
          voice: n.capabilities.voice,
          sms: n.capabilities.sms,
          mms: n.capabilities.mms,
        },
      }));
    } catch (error) {
      this.logger.error(`Error searching toll-free numbers: ${error.message}`);
      throw new BadRequestException(`Failed to search toll-free numbers: ${error.message}`);
    }
  }

  /**
   * Build webhook URL for Twilio
   */
  private buildWebhookUrl(type: 'voice' | 'sms', tenantId: string, phoneId: string): string {
    const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
    return `${baseUrl}/api/v1/twilio/${type}/incoming/${tenantId}/${phoneId}`;
  }

  /**
   * Purchase a phone number from Twilio
   */
  async purchaseNumber(
    phoneNumber: string,
    friendlyName: string,
    tenantId: string,
    phoneId: string,
    messagingServiceSid?: string,
  ): Promise<PurchasedPhoneNumber> {
    this.ensureClient();

    const voiceUrl = this.buildWebhookUrl('voice', tenantId, phoneId);
    const smsUrl = this.buildWebhookUrl('sms', tenantId, phoneId);

    this.logger.log(`Configuring webhooks - Voice: ${voiceUrl}, SMS: ${smsUrl}`);

    try {
      const purchased = await this.client.incomingPhoneNumbers.create({
        phoneNumber,
        friendlyName: friendlyName || phoneNumber,
        voiceUrl,
        voiceMethod: 'POST',
        smsUrl,
        smsMethod: 'POST',
        statusCallback: this.buildWebhookUrl('voice', tenantId, phoneId) + '/status',
        statusCallbackMethod: 'POST',
      });

      // Associate with messaging service if provided
      if (messagingServiceSid) {
        try {
          await this.client.messaging.v1
            .services(messagingServiceSid)
            .phoneNumbers.create({ phoneNumberSid: purchased.sid });
          this.logger.log(
            `Phone number ${purchased.phoneNumber} associated with messaging service ${messagingServiceSid}`,
          );
        } catch (msgError) {
          this.logger.warn(
            `Failed to associate phone with messaging service: ${msgError.message}`,
          );
          // Don't fail the purchase if messaging service association fails
        }
      }

      return {
        sid: purchased.sid,
        phoneNumber: purchased.phoneNumber,
        friendlyName: purchased.friendlyName,
        capabilities: {
          voice: purchased.capabilities.voice,
          sms: purchased.capabilities.sms,
          mms: purchased.capabilities.mms,
        },
      };
    } catch (error) {
      this.logger.error(`Error purchasing number: ${error.message}`);
      throw new BadRequestException(`Failed to purchase number: ${error.message}`);
    }
  }

  /**
   * Release a phone number back to Twilio
   */
  async releaseNumber(twilioSid: string): Promise<void> {
    this.ensureClient();

    try {
      await this.client.incomingPhoneNumbers(twilioSid).remove();
    } catch (error) {
      this.logger.error(`Error releasing number: ${error.message}`);
      throw new BadRequestException(`Failed to release number: ${error.message}`);
    }
  }

  /**
   * Update phone number configuration
   */
  async updateNumber(twilioSid: string, updates: { friendlyName?: string }): Promise<void> {
    this.ensureClient();

    try {
      await this.client.incomingPhoneNumbers(twilioSid).update(updates);
    } catch (error) {
      this.logger.error(`Error updating number: ${error.message}`);
      throw new BadRequestException(`Failed to update number: ${error.message}`);
    }
  }

  /**
   * Send an SMS message
   * Uses messaging service if provided, otherwise uses from number
   */
  async sendSms(params: {
    to: string;
    body: string;
    from?: string;
    messagingServiceSid?: string;
    statusCallback?: string;
  }): Promise<{ sid: string; status: string }> {
    this.ensureClient();

    if (!params.from && !params.messagingServiceSid) {
      throw new BadRequestException('Either from number or messagingServiceSid is required');
    }

    try {
      const message = await this.client.messages.create({
        to: params.to,
        body: params.body,
        ...(params.messagingServiceSid
          ? { messagingServiceSid: params.messagingServiceSid }
          : { from: params.from }),
        ...(params.statusCallback && { statusCallback: params.statusCallback }),
      });

      this.logger.log(`SMS sent to ${params.to}, SID: ${message.sid}`);

      return {
        sid: message.sid,
        status: message.status,
      };
    } catch (error) {
      this.logger.error(`Error sending SMS: ${error.message}`);
      throw new BadRequestException(`Failed to send SMS: ${error.message}`);
    }
  }

  /**
   * Validate Twilio webhook signature
   */
  validateWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>,
  ): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      this.logger.warn('Cannot validate signature: TWILIO_AUTH_TOKEN not set');
      return false;
    }

    const twilio = require('twilio');
    return twilio.validateRequest(authToken, signature, url, params);
  }

  /**
   * Generate a Twilio Access Token for Voice Client (WebRTC)
   * This allows users to receive calls in their browser
   */
  generateVoiceToken(identity: string, tenantId: string): { token: string; identity: string } {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_SID;
    const apiKeySecret = process.env.TWILIO_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      throw new BadRequestException(
        'Twilio API credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_SID, and TWILIO_SECRET.',
      );
    }

    if (!twimlAppSid) {
      throw new BadRequestException(
        'TWILIO_TWIML_APP_SID not configured. Create a TwiML App in Twilio console.',
      );
    }

    // Create a unique client identity using email/userId + tenantId
    // This ensures the same user in different tenants has different identities
    const clientIdentity = `${identity}_${tenantId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.logger.log(`Voice token - input identity: "${identity}", tenantId: "${tenantId}", computed clientIdentity: "${clientIdentity}"`);

    // Create access token
    const AccessToken = jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity: clientIdentity,
      ttl: 3600, // 1 hour
    });

    // Create a Voice grant for this token
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true, // Allow incoming calls
    });

    token.addGrant(voiceGrant);

    this.logger.log(`Generated voice token for identity: ${clientIdentity}`);

    return {
      token: token.toJwt(),
      identity: clientIdentity,
    };
  }

  /**
   * Create or get TwiML App SID
   * This creates a TwiML App if one doesn't exist for voice client
   */
  async getOrCreateTwimlApp(): Promise<string> {
    this.ensureClient();

    const appName = 'HTown Autos CRM Voice Client';
    const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
    const voiceUrl = `${baseUrl}/api/v1/twilio/voice/client`;

    try {
      // Check if app already exists
      const existingApps = await this.client.applications.list({ friendlyName: appName });

      if (existingApps.length > 0) {
        // Update existing app with current URL
        const app = await this.client.applications(existingApps[0].sid).update({
          voiceUrl,
          voiceMethod: 'POST',
        });
        this.logger.log(`Updated existing TwiML App: ${app.sid}`);
        return app.sid;
      }

      // Create new app
      const app = await this.client.applications.create({
        friendlyName: appName,
        voiceUrl,
        voiceMethod: 'POST',
      });

      this.logger.log(`Created new TwiML App: ${app.sid}`);
      return app.sid;
    } catch (error) {
      this.logger.error(`Error managing TwiML App: ${error.message}`);
      throw new BadRequestException(`Failed to manage TwiML App: ${error.message}`);
    }
  }
}
