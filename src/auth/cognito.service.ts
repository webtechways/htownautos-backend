import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';

interface CreateUserParams {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface CreateUserResult {
  cognitoSub: string;
  email: string;
}

@Injectable()
export class CognitoService {
  private readonly logger = new Logger(CognitoService.name);
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;

  constructor() {
    this.userPoolId = process.env.COGNITO_USER_POOL_ID!;

    this.client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * Create a new user in Cognito
   * Uses AdminCreateUser to create user, then AdminSetUserPassword to set permanent password
   */
  async createUser(params: CreateUserParams): Promise<CreateUserResult> {
    const { email, password, firstName, lastName } = params;

    this.logger.log('========================================');
    this.logger.log('CREATING USER IN COGNITO');
    this.logger.log('========================================');
    this.logger.log(`Email: ${email}`);
    this.logger.log(`Name: ${firstName} ${lastName}`);

    try {
      // Step 1: Create user with AdminCreateUser
      // SUPPRESS sends no welcome email, we manage our own invitation flow
      const createCommand = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'given_name', Value: firstName },
          { Name: 'family_name', Value: lastName },
          { Name: 'name', Value: `${firstName} ${lastName}` },
        ],
        MessageAction: MessageActionType.SUPPRESS, // Don't send default welcome email
      });

      const createResponse = await this.client.send(createCommand);

      if (!createResponse.User?.Username) {
        throw new Error('Failed to create user in Cognito');
      }

      // Get the sub (Cognito user ID)
      const subAttribute = createResponse.User.Attributes?.find(
        (attr) => attr.Name === 'sub',
      );

      if (!subAttribute?.Value) {
        throw new Error('Cognito sub not found in response');
      }

      const cognitoSub = subAttribute.Value;

      this.logger.log(`User created in Cognito with sub: ${cognitoSub}`);

      // Step 2: Set permanent password using AdminSetUserPassword
      const setPasswordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        Password: password,
        Permanent: true, // Set as permanent, not temporary
      });

      await this.client.send(setPasswordCommand);

      this.logger.log('Password set successfully');
      this.logger.log('========================================');

      return {
        cognitoSub,
        email,
      };
    } catch (error: any) {
      this.logger.error('Failed to create user in Cognito:', error.message);

      // Handle specific Cognito errors
      if (error.name === 'UsernameExistsException') {
        // User already exists in Cognito - get their sub and update password
        this.logger.log('User already exists in Cognito, retrieving existing user...');
        return this.handleExistingUser(email, password);
      }

      if (error.name === 'InvalidPasswordException') {
        throw new BadRequestException(
          'Password does not meet requirements. Must be at least 8 characters with uppercase, lowercase, numbers, and special characters.',
        );
      }

      if (error.name === 'InvalidParameterException') {
        throw new BadRequestException(
          error.message || 'Invalid parameter provided',
        );
      }

      throw new BadRequestException(
        `Failed to create account: ${error.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Handle the case where user already exists in Cognito
   * Gets their sub and updates their password
   */
  private async handleExistingUser(email: string, password: string): Promise<CreateUserResult> {
    try {
      // Get existing user to retrieve their sub
      const getUserCommand = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
      });

      const userResponse = await this.client.send(getUserCommand);

      const subAttribute = userResponse.UserAttributes?.find(
        (attr) => attr.Name === 'sub',
      );

      if (!subAttribute?.Value) {
        throw new Error('Cognito sub not found for existing user');
      }

      const cognitoSub = subAttribute.Value;

      this.logger.log(`Found existing Cognito user with sub: ${cognitoSub}`);

      // Update their password to the new one
      const setPasswordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      });

      await this.client.send(setPasswordCommand);

      this.logger.log('Password updated for existing user');
      this.logger.log('========================================');

      return {
        cognitoSub,
        email,
      };
    } catch (error: any) {
      this.logger.error('Failed to handle existing user:', error.message);

      if (error.name === 'InvalidPasswordException') {
        throw new BadRequestException(
          'Password does not meet requirements. Must be at least 8 characters with uppercase, lowercase, numbers, and special characters.',
        );
      }

      throw new BadRequestException(
        `Failed to process account: ${error.message || 'Unknown error'}`,
      );
    }
  }
}
