import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface InvitationEmailData {
  to: string;
  tenantName: string;
  roleName: string;
  invitationUrl: string;
  expiresAt: Date;
  inviterName?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly sesClient: SESClient;
  private readonly fromEmail: string;
  private readonly isEnabled: boolean;

  constructor() {
    this.fromEmail = process.env.SES_FROM_EMAIL || 'notify@htownautos.com';
    this.isEnabled = process.env.SES_ENABLED !== 'false';

    this.sesClient = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Send invitation email to a user
   */
  async sendInvitationEmail(data: InvitationEmailData): Promise<boolean> {
    const { to, tenantName, roleName, invitationUrl, expiresAt, inviterName } = data;

    const subject = `You've been invited to join ${tenantName}`;
    const htmlBody = this.getInvitationHtmlTemplate(data);
    const textBody = this.getInvitationTextTemplate(data);

    return this.sendEmail({
      to,
      subject,
      htmlBody,
      textBody,
    });
  }

  /**
   * Generic send email method
   */
  private async sendEmail(params: {
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
  }): Promise<boolean> {
    const { to, subject, htmlBody, textBody } = params;

    if (!this.isEnabled) {
      this.logger.warn(`Email sending disabled. Would have sent to: ${to}`);
      return false;
    }

    try {
      const command = new SendEmailCommand({
        Source: this.fromEmail,
        Destination: {
          ToAddresses: [to],
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8',
            },
            Text: {
              Data: textBody,
              Charset: 'UTF-8',
            },
          },
        },
      });

      const response = await this.sesClient.send(command);
      this.logger.log(`Email sent successfully to ${to}. MessageId: ${response.MessageId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`);
      // Don't throw - email failure shouldn't break the invitation flow
      return false;
    }
  }

  /**
   * HTML template for invitation email
   */
  private getInvitationHtmlTemplate(data: InvitationEmailData): string {
    const { tenantName, roleName, invitationUrl, expiresAt, inviterName } = data;
    const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to ${tenantName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #18181b;">
                HTown Autos CRM
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">
                You've been invited!
              </h2>

              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #52525b;">
                ${inviterName ? `<strong>${inviterName}</strong> has invited you` : 'You have been invited'} to join <strong>${tenantName}</strong> as a <strong>${roleName}</strong>.
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${invitationUrl}"
                       style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; transition: background-color 0.2s;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Details Box -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f4f5; border-radius: 8px; margin-top: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">
                      <strong>Business:</strong> ${tenantName}
                    </p>
                    <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">
                      <strong>Role:</strong> ${roleName}
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #71717a;">
                      <strong>Expires:</strong> ${expiresFormatted}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Link fallback -->
              <p style="margin: 24px 0 0; font-size: 14px; color: #a1a1aa;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #2563eb; word-break: break-all;">
                ${invitationUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #e4e4e7; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                This invitation will expire on ${expiresFormatted}.
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #a1a1aa;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
              <p style="margin: 16px 0 0; font-size: 12px; color: #a1a1aa;">
                &copy; ${new Date().getFullYear()} HTown Autos. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  /**
   * Plain text template for invitation email
   */
  private getInvitationTextTemplate(data: InvitationEmailData): string {
    const { tenantName, roleName, invitationUrl, expiresAt, inviterName } = data;
    const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
You've been invited to join ${tenantName}!

${inviterName ? `${inviterName} has invited you` : 'You have been invited'} to join ${tenantName} as a ${roleName}.

Click the link below to accept the invitation:
${invitationUrl}

Details:
- Business: ${tenantName}
- Role: ${roleName}
- Expires: ${expiresFormatted}

If you didn't expect this invitation, you can safely ignore this email.

---
HTown Autos CRM
    `.trim();
  }
}
