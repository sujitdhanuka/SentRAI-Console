import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { UserEntity } from './entities';
import { Role } from '../common/enums';
import { hashPassword } from '../common/password';

const DEV_DEFAULT_PASSWORD = 'admin123';
const MIN_SEED_PASSWORD_LEN = 12;

/**
 * Creates the bootstrap admin on startup if it does not yet exist.
 *
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. In production
 * (NODE_ENV=production or MariaDB) the well-known dev default is NEVER seeded:
 * if no password is supplied a strong random one is generated and logged once,
 * so the operator can capture it and change it on first sign-in. Only local
 * SQLite dev falls back to the convenience password.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const seed = this.config.get<{ email: string; password: string | null; reset: boolean }>('seedAdmin')!;
    const productionLike = this.config.get<boolean>('productionLike');

    const existing = await this.users.findOne({ where: { email: seed.email } });
    if (existing) {
      // Recovery path: SEED_ADMIN_RESET=true forces the existing admin's
      // password back to SEED_ADMIN_PASSWORD (and reactivates it). For a
      // locked-out operator — unset the flag again after signing in.
      if (seed.reset && seed.password) {
        if (productionLike && seed.password.length < MIN_SEED_PASSWORD_LEN) {
          throw new Error(`FATAL: SEED_ADMIN_PASSWORD must be at least ${MIN_SEED_PASSWORD_LEN} characters in production.`);
        }
        existing.hashedPassword = hashPassword(seed.password);
        existing.isActive = true;
        existing.role = Role.ADMIN;
        existing.updatedAt = new Date();
        await this.users.save(existing);
        this.logger.warn(
          `SEED_ADMIN_RESET: reset password for existing admin '${seed.email}'. ` +
            'Remove SEED_ADMIN_RESET from the environment after signing in.',
        );
      } else if (seed.reset && !seed.password) {
        this.logger.warn('SEED_ADMIN_RESET is set but SEED_ADMIN_PASSWORD is empty — nothing to reset.');
      }
      return;
    }

    let password = seed.password;
    let generated = false;

    if (password) {
      if (productionLike && password.length < MIN_SEED_PASSWORD_LEN) {
        throw new Error(
          `FATAL: SEED_ADMIN_PASSWORD must be at least ${MIN_SEED_PASSWORD_LEN} characters in production.`,
        );
      }
    } else if (productionLike) {
      // Never seed the known dev password in production — mint a strong one.
      password = randomBytes(18).toString('base64url'); // ~24 URL-safe chars
      generated = true;
    } else {
      password = DEV_DEFAULT_PASSWORD; // local SQLite convenience only
    }

    const now = new Date();
    await this.users.save(
      this.users.create({
        id: uuidv4(),
        email: seed.email,
        fullName: 'Administrator',
        hashedPassword: hashPassword(password),
        role: Role.ADMIN,
        tenantId: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    if (generated) {
      // One-time disclosure in the boot log (self-hosted operator context).
      this.logger.warn(
        `Seeded admin '${seed.email}' with a GENERATED password: ${password}\n` +
          '  ↳ Store it now and change it on first sign-in — it will NOT be shown again.',
      );
    } else if (productionLike) {
      this.logger.log(`Seeded admin '${seed.email}' from SEED_ADMIN_PASSWORD.`);
    } else {
      this.logger.warn(
        `Seeded DEV admin '${seed.email}' / '${DEV_DEFAULT_PASSWORD}' (local only — never used in production).`,
      );
    }
  }
}
