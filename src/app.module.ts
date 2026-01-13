import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { VehicleYearModule } from './vehicle-year/vehicle-year.module';
import { VehicleMakeModule } from './vehicle-make/vehicle-make.module';
import { VehicleModelModule } from './vehicle-model/vehicle-model.module';
import { VehicleTrimModule } from './vehicle-trim/vehicle-trim.module';
import { NomenclatorsModule } from './nomenclators/nomenclators.module';
import { ExtraExpenseModule } from './extra-expense/extra-expense.module';

@Module({
  imports: [
    PrismaModule,
    VehicleYearModule,
    VehicleMakeModule,
    VehicleModelModule,
    VehicleTrimModule,
    NomenclatorsModule,
    ExtraExpenseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
