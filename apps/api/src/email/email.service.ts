import { Injectable, Logger } from '@nestjs/common';

export type CodePurpose = 'verify_email' | 'reset_password' | 'delete_account';

/**
 * Sends transactional email. Development logs codes to the console (TRACKER D19);
 * a real provider will implement the same method (BACKLOG B-PLAT-9).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('dev-email');

  async sendCode(to: string, purpose: CodePurpose, code: string): Promise<void> {
    const label = { verify_email: 'verify', reset_password: 'reset', delete_account: 'delete-account' }[purpose];
    this.logger.log(`${label} code for ${to}: ${code}`);
  }
}
