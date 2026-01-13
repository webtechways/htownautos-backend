-- CreateTable
CREATE TABLE "sale_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mileage_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mileage_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "title_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_conditions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transmission_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_sources" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferred_languages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferred_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_methods" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_times" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genders" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "id_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "id_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "id_states" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "id_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "occupations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_years" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_makes" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL,
    "makeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_trims" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_trims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "suffix" TEXT,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "genderId" TEXT,
    "ssn" TEXT,
    "itin" TEXT,
    "citizenship" TEXT,
    "email" TEXT NOT NULL,
    "phoneMain" TEXT NOT NULL,
    "phoneSecondary" TEXT,
    "phoneMobile" TEXT,
    "preferredLanguageId" TEXT,
    "currentAddress" TEXT NOT NULL,
    "currentCity" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "currentZipCode" TEXT NOT NULL,
    "currentCountry" TEXT NOT NULL DEFAULT 'USA',
    "yearsAtAddress" INTEGER,
    "monthsAtAddress" INTEGER,
    "housingStatus" TEXT,
    "monthlyHousingCost" DECIMAL(10,2),
    "previousAddress" TEXT,
    "previousCity" TEXT,
    "previousState" TEXT,
    "previousZipCode" TEXT,
    "previousCountry" TEXT,
    "yearsAtPreviousAddress" INTEGER,
    "monthsAtPreviousAddress" INTEGER,
    "idTypeId" TEXT,
    "idNumber" TEXT,
    "idStateId" TEXT,
    "idExpirationDate" TIMESTAMP(3),
    "idIssueDate" TIMESTAMP(3),
    "driversLicenseNumber" TEXT,
    "driversLicenseState" TEXT,
    "driversLicenseExpiration" TIMESTAMP(3),
    "employmentStatusId" TEXT,
    "currentEmployer" TEXT,
    "employerPhone" TEXT,
    "occupationId" TEXT,
    "jobTitle" TEXT,
    "employerAddress" TEXT,
    "employerCity" TEXT,
    "employerState" TEXT,
    "employerZipCode" TEXT,
    "monthlyIncome" DECIMAL(10,2),
    "yearsEmployed" INTEGER,
    "monthsEmployed" INTEGER,
    "additionalIncome" DECIMAL(10,2),
    "additionalIncomeSource" TEXT,
    "previousEmployer" TEXT,
    "previousEmployerPhone" TEXT,
    "previousJobTitle" TEXT,
    "previousEmployerAddress" TEXT,
    "previousEmployerCity" TEXT,
    "previousEmployerState" TEXT,
    "previousEmployerZipCode" TEXT,
    "previousMonthlyIncome" DECIMAL(10,2),
    "previousYearsEmployed" INTEGER,
    "previousMonthsEmployed" INTEGER,
    "bankName" TEXT,
    "bankAccountType" TEXT,
    "bankRoutingNumber" TEXT,
    "bankAccountNumber" TEXT,
    "yearsWithBank" INTEGER,
    "monthsWithBank" INTEGER,
    "creditScore" INTEGER,
    "bankruptcyHistory" BOOLEAN NOT NULL DEFAULT false,
    "bankruptcyDate" TIMESTAMP(3),
    "bankruptcyType" TEXT,
    "bankruptcyDischargeDate" TIMESTAMP(3),
    "repoHistory" BOOLEAN NOT NULL DEFAULT false,
    "repoDate" TIMESTAMP(3),
    "foreclosureHistory" BOOLEAN NOT NULL DEFAULT false,
    "foreclosureDate" TIMESTAMP(3),
    "currentMonthlyDebts" DECIMAL(10,2),
    "alimonyChildSupport" DECIMAL(10,2),
    "reference1Name" TEXT,
    "reference1Phone" TEXT,
    "reference1Relation" TEXT,
    "reference1Address" TEXT,
    "reference1YearsKnown" INTEGER,
    "reference2Name" TEXT,
    "reference2Phone" TEXT,
    "reference2Relation" TEXT,
    "reference2Address" TEXT,
    "reference2YearsKnown" INTEGER,
    "reference3Name" TEXT,
    "reference3Phone" TEXT,
    "reference3Relation" TEXT,
    "reference3Address" TEXT,
    "reference3YearsKnown" INTEGER,
    "reference4Name" TEXT,
    "reference4Phone" TEXT,
    "reference4Relation" TEXT,
    "reference4Address" TEXT,
    "reference4YearsKnown" INTEGER,
    "reference5Name" TEXT,
    "reference5Phone" TEXT,
    "reference5Relation" TEXT,
    "reference5Address" TEXT,
    "reference5YearsKnown" INTEGER,
    "isBusinessBuyer" BOOLEAN NOT NULL DEFAULT false,
    "businessName" TEXT,
    "businessType" TEXT,
    "businessEIN" TEXT,
    "businessYearsInBusiness" INTEGER,
    "businessAnnualRevenue" DECIMAL(12,2),
    "ofacCheckCompleted" BOOLEAN NOT NULL DEFAULT false,
    "ofacCheckDate" TIMESTAMP(3),
    "ofacCheckResult" TEXT,
    "ofacNotes" TEXT,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "identityVerifiedDate" TIMESTAMP(3),
    "identityVerifiedBy" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "coBuyerId" TEXT,
    "dealNumber" TEXT NOT NULL,
    "dealStatusId" TEXT NOT NULL,
    "financeTypeId" TEXT,
    "dealDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "fundedDate" TIMESTAMP(3),
    "vehiclePrice" DECIMAL(10,2) NOT NULL,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2),
    "rebate" DECIMAL(10,2),
    "hasTradeIn" BOOLEAN NOT NULL DEFAULT false,
    "tradeInYear" INTEGER,
    "tradeInMake" TEXT,
    "tradeInModel" TEXT,
    "tradeInVin" TEXT,
    "tradeInMileage" INTEGER,
    "tradeInActualValue" DECIMAL(10,2),
    "tradeInAllowance" DECIMAL(10,2),
    "tradeInPayoff" DECIMAL(10,2),
    "tradeInLienHolder" TEXT,
    "tradeInEquity" DECIMAL(10,2),
    "salesTax" DECIMAL(10,2),
    "docFee" DECIMAL(10,2),
    "titleFee" DECIMAL(10,2),
    "registrationFee" DECIMAL(10,2),
    "otherFees" DECIMAL(10,2),
    "totalFees" DECIMAL(10,2),
    "totalCashPrice" DECIMAL(10,2),
    "downPayment" DECIMAL(10,2),
    "amountFinanced" DECIMAL(10,2),
    "apr" DECIMAL(5,3),
    "term" INTEGER,
    "monthlyPayment" DECIMAL(10,2),
    "totalOfPayments" DECIMAL(10,2),
    "financeCharge" DECIMAL(10,2),
    "lenderName" TEXT,
    "lenderId" TEXT,
    "lenderRate" DECIMAL(5,3),
    "dealerReserve" DECIMAL(5,3),
    "buyRate" DECIMAL(5,3),
    "sellRate" DECIMAL(5,3),
    "hasWarranty" BOOLEAN NOT NULL DEFAULT false,
    "warrantyProvider" TEXT,
    "warrantyCost" DECIMAL(10,2),
    "warrantyTerm" INTEGER,
    "warrantyDeductible" DECIMAL(10,2),
    "hasGap" BOOLEAN NOT NULL DEFAULT false,
    "gapProvider" TEXT,
    "gapCost" DECIMAL(10,2),
    "hasMaintenancePlan" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceProvider" TEXT,
    "maintenanceCost" DECIMAL(10,2),
    "hasTheftProtection" BOOLEAN NOT NULL DEFAULT false,
    "theftProtectionCost" DECIMAL(10,2),
    "hasPaintProtection" BOOLEAN NOT NULL DEFAULT false,
    "paintProtectionCost" DECIMAL(10,2),
    "totalAftermarketProducts" DECIMAL(10,2),
    "loanToValue" DECIMAL(5,2),
    "paymentToIncome" DECIMAL(5,2),
    "debtToIncome" DECIMAL(5,2),
    "creditCheckConsent" BOOLEAN NOT NULL DEFAULT false,
    "creditCheckDate" TIMESTAMP(3),
    "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
    "termsAcceptedDate" TIMESTAMP(3),
    "privacyPolicyAccepted" BOOLEAN NOT NULL DEFAULT false,
    "electronicDisclosureConsent" BOOLEAN NOT NULL DEFAULT false,
    "creditReportPulled" BOOLEAN NOT NULL DEFAULT false,
    "creditReportDate" TIMESTAMP(3),
    "creditReportProvider" TEXT,
    "creditScore" INTEGER,
    "applicationStatus" TEXT,
    "applicationDate" TIMESTAMP(3),
    "approvalDate" TIMESTAMP(3),
    "denialDate" TIMESTAMP(3),
    "denialReason" TEXT,
    "stipulations" TEXT,
    "dealertrackAppId" TEXT,
    "dealertrackStatus" TEXT,
    "dealertrackSubmittedDate" TIMESTAMP(3),
    "routeoneAppId" TEXT,
    "routeoneStatus" TEXT,
    "routeoneSubmittedDate" TIMESTAMP(3),
    "cudlAppId" TEXT,
    "cudlStatus" TEXT,
    "cudlSubmittedDate" TIMESTAMP(3),
    "cashTransactionOver10k" BOOLEAN NOT NULL DEFAULT false,
    "form8300Filed" BOOLEAN NOT NULL DEFAULT false,
    "form8300FiledDate" TIMESTAMP(3),
    "redFlagsChecked" BOOLEAN NOT NULL DEFAULT false,
    "redFlagsNotes" TEXT,
    "activeLoan1Type" TEXT,
    "activeLoan1Creditor" TEXT,
    "activeLoan1Balance" DECIMAL(10,2),
    "activeLoan1Payment" DECIMAL(10,2),
    "activeLoan2Type" TEXT,
    "activeLoan2Creditor" TEXT,
    "activeLoan2Balance" DECIMAL(10,2),
    "activeLoan2Payment" DECIMAL(10,2),
    "activeLoan3Type" TEXT,
    "activeLoan3Creditor" TEXT,
    "activeLoan3Balance" DECIMAL(10,2),
    "activeLoan3Payment" DECIMAL(10,2),
    "salesPersonId" TEXT,
    "salesManagerId" TEXT,
    "financeManagerId" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "customerNotes" TEXT,
    "source" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "applicationLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titles" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "titleNumber" TEXT NOT NULL,
    "titleState" TEXT NOT NULL,
    "titleType" TEXT,
    "titleStatusId" TEXT NOT NULL,
    "brandStatusId" TEXT,
    "titleIssueDate" TIMESTAMP(3),
    "titleReceivedDate" TIMESTAMP(3),
    "titleSentDate" TIMESTAMP(3),
    "ownerName" TEXT,
    "ownerAddress" TEXT,
    "ownerCity" TEXT,
    "ownerState" TEXT,
    "ownerZipCode" TEXT,
    "coOwnerName" TEXT,
    "coOwnerAddress" TEXT,
    "hasLien" BOOLEAN NOT NULL DEFAULT false,
    "lienHolder" TEXT,
    "lienHolderAddress" TEXT,
    "lienHolderCity" TEXT,
    "lienHolderState" TEXT,
    "lienHolderZipCode" TEXT,
    "lienAmount" DECIMAL(10,2),
    "lienDate" TIMESTAMP(3),
    "lienReleaseDate" TIMESTAMP(3),
    "hasSecondLien" BOOLEAN NOT NULL DEFAULT false,
    "secondLienHolder" TEXT,
    "secondLienAmount" DECIMAL(10,2),
    "odometerReading" INTEGER,
    "odometerDate" TIMESTAMP(3),
    "odometerDisclosure" TEXT,
    "odometerBrand" TEXT,
    "titleVIN" TEXT,
    "titleYear" INTEGER,
    "titleMake" TEXT,
    "titleModel" TEXT,
    "titleBodyStyle" TEXT,
    "titleColor" TEXT,
    "isPendingTransfer" BOOLEAN NOT NULL DEFAULT false,
    "transferDate" TIMESTAMP(3),
    "transferredFrom" TEXT,
    "transferredTo" TEXT,
    "fileId" TEXT,
    "lienReleaseFileId" TEXT,
    "billOfSaleFileId" TEXT,
    "odometerStatementFileId" TEXT,
    "titleVerified" BOOLEAN NOT NULL DEFAULT false,
    "titleVerifiedDate" TIMESTAMP(3),
    "titleVerifiedBy" TEXT,
    "isElectronic" BOOLEAN NOT NULL DEFAULT false,
    "electronicTitleId" TEXT,
    "nmvtisChecked" BOOLEAN NOT NULL DEFAULT false,
    "nmvtisCheckDate" TIMESTAMP(3),
    "nmvtisStatus" TEXT,
    "currentLocation" TEXT,
    "shippingTracking" TEXT,
    "expectedReturnDate" TIMESTAMP(3),
    "titleFee" DECIMAL(10,2),
    "transferFee" DECIMAL(10,2),
    "liensatisfactionFee" DECIMAL(10,2),
    "totalFees" DECIMAL(10,2),
    "notes" TEXT,
    "internalNotes" TEXT,
    "form8300Required" BOOLEAN NOT NULL DEFAULT false,
    "form8300Filed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "alt" TEXT,
    "mediaType" TEXT NOT NULL,
    "category" TEXT,
    "storageProvider" TEXT,
    "storageBucket" TEXT,
    "storageKey" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "vehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "stockNumber" TEXT,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "mileage" INTEGER,
    "exteriorColor" TEXT,
    "interiorColor" TEXT,
    "vehicleTypeId" TEXT,
    "bodyTypeId" TEXT,
    "fuelTypeId" TEXT,
    "driveTypeId" TEXT,
    "transmissionTypeId" TEXT,
    "vehicleConditionId" TEXT,
    "vehicleStatusId" TEXT,
    "sourceId" TEXT,
    "costPrice" DECIMAL(10,2),
    "listPrice" DECIMAL(10,2),
    "salePrice" DECIMAL(10,2),
    "engine" TEXT,
    "cylinders" INTEGER,
    "doors" INTEGER,
    "passengers" INTEGER,
    "description" TEXT,
    "features" TEXT,
    "mainImageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extra_expenses" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extra_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_types_slug_key" ON "sale_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "mileage_statuses_slug_key" ON "mileage_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_statuses_slug_key" ON "vehicle_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "title_statuses_slug_key" ON "title_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_conditions_slug_key" ON "vehicle_conditions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brand_statuses_slug_key" ON "brand_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_slug_key" ON "vehicle_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "body_types_slug_key" ON "body_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_types_slug_key" ON "fuel_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "drive_types_slug_key" ON "drive_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "transmission_types_slug_key" ON "transmission_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_sources_slug_key" ON "vehicle_sources"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_statuses_slug_key" ON "inspection_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "activity_types_slug_key" ON "activity_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "activity_statuses_slug_key" ON "activity_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_slug_key" ON "user_roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_slug_key" ON "lead_sources"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_types_slug_key" ON "inquiry_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "preferred_languages_slug_key" ON "preferred_languages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "contact_methods_slug_key" ON "contact_methods"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "contact_times_slug_key" ON "contact_times"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "genders_slug_key" ON "genders"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "id_types_slug_key" ON "id_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "id_states_slug_key" ON "id_states"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "employment_statuses_slug_key" ON "employment_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "occupations_slug_key" ON "occupations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "deal_statuses_slug_key" ON "deal_statuses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "finance_types_slug_key" ON "finance_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_years_year_key" ON "vehicle_years"("year");

-- CreateIndex
CREATE INDEX "vehicle_years_year_idx" ON "vehicle_years"("year");

-- CreateIndex
CREATE INDEX "vehicle_makes_yearId_idx" ON "vehicle_makes"("yearId");

-- CreateIndex
CREATE INDEX "vehicle_makes_slug_idx" ON "vehicle_makes"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_makes_yearId_slug_key" ON "vehicle_makes"("yearId", "slug");

-- CreateIndex
CREATE INDEX "vehicle_models_makeId_idx" ON "vehicle_models"("makeId");

-- CreateIndex
CREATE INDEX "vehicle_models_slug_idx" ON "vehicle_models"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_makeId_slug_key" ON "vehicle_models"("makeId", "slug");

-- CreateIndex
CREATE INDEX "vehicle_trims_modelId_idx" ON "vehicle_trims"("modelId");

-- CreateIndex
CREATE INDEX "vehicle_trims_slug_idx" ON "vehicle_trims"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_trims_modelId_slug_key" ON "vehicle_trims"("modelId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "buyers_email_idx" ON "buyers"("email");

-- CreateIndex
CREATE INDEX "buyers_lastName_firstName_idx" ON "buyers"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "buyers_ssn_idx" ON "buyers"("ssn");

-- CreateIndex
CREATE INDEX "buyers_dateOfBirth_idx" ON "buyers"("dateOfBirth");

-- CreateIndex
CREATE UNIQUE INDEX "deals_dealNumber_key" ON "deals"("dealNumber");

-- CreateIndex
CREATE INDEX "deals_buyerId_idx" ON "deals"("buyerId");

-- CreateIndex
CREATE INDEX "deals_coBuyerId_idx" ON "deals"("coBuyerId");

-- CreateIndex
CREATE INDEX "deals_vehicleId_idx" ON "deals"("vehicleId");

-- CreateIndex
CREATE INDEX "deals_dealNumber_idx" ON "deals"("dealNumber");

-- CreateIndex
CREATE INDEX "deals_dealStatusId_idx" ON "deals"("dealStatusId");

-- CreateIndex
CREATE INDEX "deals_dealDate_idx" ON "deals"("dealDate");

-- CreateIndex
CREATE INDEX "deals_dealertrackAppId_idx" ON "deals"("dealertrackAppId");

-- CreateIndex
CREATE INDEX "deals_routeoneAppId_idx" ON "deals"("routeoneAppId");

-- CreateIndex
CREATE INDEX "deals_cudlAppId_idx" ON "deals"("cudlAppId");

-- CreateIndex
CREATE INDEX "deals_salesPersonId_idx" ON "deals"("salesPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "titles_titleNumber_key" ON "titles"("titleNumber");

-- CreateIndex
CREATE INDEX "titles_vehicleId_idx" ON "titles"("vehicleId");

-- CreateIndex
CREATE INDEX "titles_titleNumber_idx" ON "titles"("titleNumber");

-- CreateIndex
CREATE INDEX "titles_titleState_idx" ON "titles"("titleState");

-- CreateIndex
CREATE INDEX "titles_titleStatusId_idx" ON "titles"("titleStatusId");

-- CreateIndex
CREATE INDEX "titles_brandStatusId_idx" ON "titles"("brandStatusId");

-- CreateIndex
CREATE INDEX "titles_hasLien_idx" ON "titles"("hasLien");

-- CreateIndex
CREATE INDEX "titles_isPendingTransfer_idx" ON "titles"("isPendingTransfer");

-- CreateIndex
CREATE INDEX "titles_fileId_idx" ON "titles"("fileId");

-- CreateIndex
CREATE INDEX "titles_lienReleaseFileId_idx" ON "titles"("lienReleaseFileId");

-- CreateIndex
CREATE INDEX "titles_billOfSaleFileId_idx" ON "titles"("billOfSaleFileId");

-- CreateIndex
CREATE INDEX "titles_odometerStatementFileId_idx" ON "titles"("odometerStatementFileId");

-- CreateIndex
CREATE INDEX "media_vehicleId_idx" ON "media"("vehicleId");

-- CreateIndex
CREATE INDEX "media_mediaType_idx" ON "media"("mediaType");

-- CreateIndex
CREATE INDEX "media_category_idx" ON "media"("category");

-- CreateIndex
CREATE INDEX "media_isActive_idx" ON "media"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_stockNumber_key" ON "vehicles"("stockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_mainImageId_key" ON "vehicles"("mainImageId");

-- CreateIndex
CREATE INDEX "vehicles_vin_idx" ON "vehicles"("vin");

-- CreateIndex
CREATE INDEX "vehicles_stockNumber_idx" ON "vehicles"("stockNumber");

-- CreateIndex
CREATE INDEX "vehicles_year_make_model_idx" ON "vehicles"("year", "make", "model");

-- CreateIndex
CREATE INDEX "vehicles_vehicleStatusId_idx" ON "vehicles"("vehicleStatusId");

-- CreateIndex
CREATE INDEX "vehicles_mainImageId_idx" ON "vehicles"("mainImageId");

-- CreateIndex
CREATE INDEX "vehicles_sourceId_idx" ON "vehicles"("sourceId");

-- CreateIndex
CREATE INDEX "extra_expenses_vehicleId_idx" ON "extra_expenses"("vehicleId");

-- CreateIndex
CREATE INDEX "extra_expenses_receiptId_idx" ON "extra_expenses"("receiptId");

-- AddForeignKey
ALTER TABLE "vehicle_makes" ADD CONSTRAINT "vehicle_makes_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "vehicle_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_genderId_fkey" FOREIGN KEY ("genderId") REFERENCES "genders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_preferredLanguageId_fkey" FOREIGN KEY ("preferredLanguageId") REFERENCES "preferred_languages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_idTypeId_fkey" FOREIGN KEY ("idTypeId") REFERENCES "id_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_idStateId_fkey" FOREIGN KEY ("idStateId") REFERENCES "id_states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_employmentStatusId_fkey" FOREIGN KEY ("employmentStatusId") REFERENCES "employment_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_occupationId_fkey" FOREIGN KEY ("occupationId") REFERENCES "occupations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_coBuyerId_fkey" FOREIGN KEY ("coBuyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_dealStatusId_fkey" FOREIGN KEY ("dealStatusId") REFERENCES "deal_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_financeTypeId_fkey" FOREIGN KEY ("financeTypeId") REFERENCES "finance_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_titleStatusId_fkey" FOREIGN KEY ("titleStatusId") REFERENCES "title_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_brandStatusId_fkey" FOREIGN KEY ("brandStatusId") REFERENCES "brand_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_lienReleaseFileId_fkey" FOREIGN KEY ("lienReleaseFileId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_billOfSaleFileId_fkey" FOREIGN KEY ("billOfSaleFileId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titles" ADD CONSTRAINT "titles_odometerStatementFileId_fkey" FOREIGN KEY ("odometerStatementFileId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_bodyTypeId_fkey" FOREIGN KEY ("bodyTypeId") REFERENCES "body_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fuelTypeId_fkey" FOREIGN KEY ("fuelTypeId") REFERENCES "fuel_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driveTypeId_fkey" FOREIGN KEY ("driveTypeId") REFERENCES "drive_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_transmissionTypeId_fkey" FOREIGN KEY ("transmissionTypeId") REFERENCES "transmission_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicleConditionId_fkey" FOREIGN KEY ("vehicleConditionId") REFERENCES "vehicle_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicleStatusId_fkey" FOREIGN KEY ("vehicleStatusId") REFERENCES "vehicle_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "vehicle_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_mainImageId_fkey" FOREIGN KEY ("mainImageId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extra_expenses" ADD CONSTRAINT "extra_expenses_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extra_expenses" ADD CONSTRAINT "extra_expenses_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
