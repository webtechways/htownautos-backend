import { Module } from '@nestjs/common';
import { NomenclatorsService } from './nomenclators.service';
import { NomenclatorsController } from './nomenclators.controller';
import { PrismaModule } from '../prisma.module';
import * as controllers from './controllers';

@Module({
  imports: [PrismaModule],
  controllers: [
    NomenclatorsController,
    controllers.SaleTypesController,
    controllers.MileageStatusesController,
    controllers.VehicleStatusesController,
    controllers.TitleStatusesController,
    controllers.VehicleConditionsController,
    controllers.BrandStatusesController,
    controllers.VehicleTypesController,
    controllers.BodyTypesController,
    controllers.FuelTypesController,
    controllers.DriveTypesController,
    controllers.TransmissionTypesController,
    controllers.VehicleSourcesController,
    controllers.InspectionStatusesController,
    controllers.ActivityTypesController,
    controllers.ActivityStatusesController,
    controllers.UserRolesController,
    controllers.LeadSourcesController,
    controllers.InquiryTypesController,
    controllers.PreferredLanguagesController,
    controllers.ContactMethodsController,
    controllers.ContactTimesController,
    controllers.GendersController,
    controllers.IdTypesController,
    controllers.IdStatesController,
    controllers.EmploymentStatusesController,
    controllers.OccupationsController,
    controllers.DealStatusesController,
    controllers.FinanceTypesController,
  ],
  providers: [NomenclatorsService],
  exports: [NomenclatorsService],
})
export class NomenclatorsModule {}
