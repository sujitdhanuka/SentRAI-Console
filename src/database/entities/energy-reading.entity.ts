import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Measured energy use of a model over a period, with CO2e (governance E3.5). */
@Entity({ name: 'energy_readings' })
export class EnergyReadingEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('datetime')
  periodStart!: Date;

  @Column('datetime')
  periodEnd!: Date;

  @Column('double')
  kwh!: number;

  @Column('double')
  gridFactor!: number;

  @Column('double')
  co2eKg!: number;

  @Column('varchar', { length: 30 })
  source!: string;

  @Column('int')
  sampleCount!: number;

  @Column('varchar', { length: 500, nullable: true })
  note!: string | null;

  @Column('varchar', { length: 255 })
  recordedBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
