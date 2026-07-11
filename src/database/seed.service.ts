import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { UserEntity } from './entities';
import { Role } from '../common/enums';
import { hashPassword } from '../common/password';

/**
 * Creates the default global admin on startup if it does not yet exist.
 * Replaces the FastAPI lifespan hook in main.py.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.users.findOne({ where: { email: 'admin@sentrai.local' } });
    if (existing) return;

    const now = new Date();
    await this.users.save(
      this.users.create({
        id: uuidv4(),
        email: 'admin@sentrai.local',
        fullName: 'Default Admin',
        hashedPassword: hashPassword('admin123'),
        role: Role.ADMIN,
        tenantId: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
    this.logger.log('Seeded default admin user admin@sentrai.local');
  }
}
