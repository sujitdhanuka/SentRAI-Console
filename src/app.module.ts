import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { AppController } from './app.controller';
import { STATIC_DIR, IMAGES_DIR, DASHBOARD_DIR } from './common/paths';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ViewerReadOnlyGuard } from './common/guards/viewer-readonly.guard';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { InventoryModule } from './inventory/inventory.module';
import { GenerationModule } from './inventory/generation.module';
import { IncidentsModule } from './incidents/incidents.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { AuditModule } from './audit/audit.module';
import { MetricsModule } from './metrics/metrics.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { TasksModule } from './tasks/tasks.module';
import { CiModule } from './ci/ci.module';
import { ComplianceModule } from './compliance/compliance.module';
import { AiModule } from './ai/ai.module';
import { AlignmentModule } from './alignment/alignment.module';
import { ControlModule } from './control/control.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { GrievancesModule } from './grievances/grievances.module';
import { LeadsModule } from './leads/leads.module';
import { CardsModule } from './cards/cards.module';
import { AdminModule } from './admin/admin.module';
import { GovernanceModule } from './governance/governance.module';
import { WorkflowsModule } from './governance/workflows/workflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Global rate limiting: 300 requests / minute per IP (the SPA fires many
    // calls on load). Auth endpoints tighten this with per-route @Throttle.
    // Disabled under test so the e2e suite's rapid logins aren't throttled.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    ProjectsModule,
    GenerationModule,
    InventoryModule,
    IncidentsModule,
    MonitoringModule,
    AuditModule,
    MetricsModule,
    DiscoveryModule,
    TasksModule,
    CiModule,
    ComplianceModule,
    AiModule,
    AlignmentModule,
    ControlModule,
    TelemetryModule,
    GrievancesModule,
    LeadsModule,
    CardsModule,
    AdminModule,
    GovernanceModule,
    WorkflowsModule,
    // Mirrors FastAPI's StaticFiles mounts: /static -> web/static, /images -> docs/images
    ServeStaticModule.forRoot(
      { rootPath: STATIC_DIR, serveRoot: '/static' },
      { rootPath: IMAGES_DIR, serveRoot: '/images' },
      // The React fleet dashboard (console-ui), built into public/dashboard.
      { rootPath: DASHBOARD_DIR, serveRoot: '/dashboard' },
    ),
  ],
  controllers: [AppController],
  providers: [
    // Rate limit first, then authenticate, then check roles, then enforce that
    // the VIEWER tier is read-only across every controller.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ViewerReadOnlyGuard },
  ],
})
export class AppModule {}
