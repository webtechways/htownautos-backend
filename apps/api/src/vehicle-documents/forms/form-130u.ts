/**
 * Formulario 130-U de Texas: de nuestros datos a los campos de la plantilla.
 *
 * Los nombres de la izquierda son EXACTAMENTE los de la plantilla de DocuSeal,
 * copiados de `GET /api/templates/1`. DocuSeal rellena por nombre: una letra
 * distinta y el campo se queda vacio sin que nadie avise. Por eso van en un
 * solo sitio y con una prueba que los contrasta contra la plantilla real.
 *
 * Varios campos del PDF juntan en una sola caja lo que el formulario impreso
 * separa en columnas ("First Name  Middle Name  Last Name  Suffix"), asi que
 * aqui se componen con espacios.
 */

export interface Datos130U {
  applyingFor: 'TITLE_AND_REGISTRATION' | 'TITLE_ONLY' | 'REGISTRATION_ONLY' | 'NONTITLE_REGISTRATION';
  correctionReason?: 'VEHICLE_DESCRIPTION' | 'ADD_REMOVE_LIEN' | 'OTHER' | null;
  correctionOther?: string;

  applicantType: 'INDIVIDUAL' | 'BUSINESS' | 'GOVERNMENT' | 'TRUST' | 'NON_PROFIT';

  applicantName: string;
  additionalApplicantName?: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingState?: string;
  mailingZip?: string;
  countyOfResidence?: string;
  phone?: string;
  email?: string;
  photoIdNumber?: string;
  idType?:
    | 'US_DRIVER_LICENSE'
    | 'PASSPORT'
    | 'CITIZENSHIP_DOJ'
    | 'NATO'
    | 'US_MILITARY'
    | 'STATUS_OF_FORCES'
    | 'DEPT_OF_STATE'
    | 'DHS'
    | 'TX_HANDGUN_LICENSE';
  idIssuedBy?: string;
  militaryStatus?: 'ACTIVE' | 'RETIRED_VET' | 'RESERVE' | null;
  communicationImpediment?: boolean;

  vin: string;
  year?: string;
  make?: string;
  bodyStyle?: string;
  model?: string;
  majorColor?: string;
  minorColor?: string;
  plateNumber?: string;
  odometer?: string;
  odometerBrand?: 'NOT_ACTUAL' | 'EXCEEDS_MECHANICAL_LIMITS' | 'EXEMPT' | null;
  emptyWeight?: string;
  carryingCapacity?: string;
  vehicleLocationAddress?: string;

  previousOwner?: string;
  dealerGdn?: string;
  unitNumber?: string;
  renewalRecipient?: string;
  renewalAddress?: string;
  multipleLiens?: boolean;
  electronicTitleRequest?: boolean;
  lienholderId?: string;
  firstLienDate?: string;
  lienholder?: string;

  salesPrice?: string;
  rebate?: string;
  tradeInAmount?: string;
  tradeIn?: string;
  additionalTradeIns?: boolean;
  fairMarketDeduction?: string;
  taxableAmount?: string;
  penaltyPercent?: '5' | '10' | null;
  penaltyAmount?: string;
  taxPaidToState?: string;
  taxPaidAmount?: string;
  totalDue?: string;
  exemptionReason?: string;
  retailerPermitNumber?: string;
  gdnOrLessorNumber?: string;

  physicallyInspected?: boolean;
  correctedTitleLost?: boolean;
  sellerName?: string;
}

const juntar = (partes: Array<string | undefined>) => partes.filter(Boolean).join('  ') || undefined;

/** Campo del PDF -> valor. Solo se envian los que tienen contenido. */
export function mapear130U(d: Datos130U): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  const poner = (campo: string, valor: unknown) => {
    if (valor === undefined || valor === null || valor === '' || valor === false) return;
    v[campo] = valor;
  };

  poner('Title  Registration', d.applyingFor === 'TITLE_AND_REGISTRATION');
  poner('Title Only', d.applyingFor === 'TITLE_ONLY');
  poner('Registration Purposes Only', d.applyingFor === 'REGISTRATION_ONLY');
  poner('Nontitle Registration', d.applyingFor === 'NONTITLE_REGISTRATION');

  poner('Vehicle Description', d.correctionReason === 'VEHICLE_DESCRIPTION');
  poner('AddRemove Lien', d.correctionReason === 'ADD_REMOVE_LIEN');
  poner('Other', d.correctionReason === 'OTHER');
  poner('Other Reason For Correction', d.correctionOther);

  poner('1 Vehicle Identification Number', d.vin);
  poner('2 Year', d.year);
  poner('3 Make', d.make);
  poner('4 Body Style', d.bodyStyle);
  poner('5 Model', d.model);
  poner('6 Major Color', d.majorColor);
  poner('7 Minor Color', d.minorColor);
  poner('8 Texas License Plate No', d.plateNumber);
  poner('9 Odometer Reading no tenths', d.odometer);
  poner('Not Actual', d.odometerBrand === 'NOT_ACTUAL');
  poner('Exceeds Mechanical Limits', d.odometerBrand === 'EXCEEDS_MECHANICAL_LIMITS');
  poner('Exempt', d.odometerBrand === 'EXEMPT');
  poner('11 Empty Weight', d.emptyWeight);
  poner('12 Carrying Capacity if any', d.carryingCapacity);

  poner('Individual', d.applicantType === 'INDIVIDUAL');
  poner('Business', d.applicantType === 'BUSINESS');
  poner('Government', d.applicantType === 'GOVERNMENT');
  poner('Trust', d.applicantType === 'TRUST');
  poner('NonProfit', d.applicantType === 'NON_PROFIT');

  poner('14 Applicant Photo ID Number or FEINEIN', d.photoIdNumber);
  poner('Passport', d.idType === 'PASSPORT');
  poner('Passport Issued', d.idType === 'PASSPORT' ? d.idIssuedBy : undefined);
  poner('NATO ID', d.idType === 'NATO');
  poner('US Military ID', d.idType === 'US_MILITARY');
  poner('Status of Forces Agreement ID', d.idType === 'STATUS_OF_FORCES');
  poner('US Dept of State ID', d.idType === 'DEPT_OF_STATE');
  poner('US Dept of Homeland Security ID', d.idType === 'DHS');
  poner('TX License to Carry a Handgun', d.idType === 'TX_HANDGUN_LICENSE');

  poner('16 Applicant First Name or Entity Name Middle Name Last Name Suffix if any', d.applicantName);
  poner('17 Additional Applicant First Name if applicable Middle Name Last Name Suffix if any', d.additionalApplicantName);
  poner(
    '18 Applicant Mailing Address City State Zip',
    juntar([d.mailingAddress, d.mailingCity, d.mailingState, d.mailingZip]),
  );
  poner('19 Applicant County of Residence', d.countyOfResidence);
  poner('25 Applicant Phone Number optional', d.phone);
  poner('26 Email optional', d.email);
  poner('Active', d.militaryStatus === 'ACTIVE');
  poner('Reserve', d.militaryStatus === 'RESERVE');
  poner('Yes Attach Form VTR-216', d.communicationImpediment);
  poner('29 Vehicle Location Address if different City State Zip', d.vehicleLocationAddress);

  poner('20 Previous Owner Name or Entity Name City State', d.previousOwner);
  poner('21 Dealer GDN if applicable', d.dealerGdn);
  poner(
    '23 Renewal Recipient First Name or Entity Name if different Middle Name Last Name Suffix if any',
    d.renewalRecipient,
  );
  poner('24 Renewal Notice Mailing Address if different City State Zip', d.renewalAddress);
  poner('Yes Attach Form VTR-267', d.multipleLiens);
  poner('Yes Cannot check 30', d.electronicTitleRequest);
  poner('32 CertifiedeTitle Lienholder ID Number if any', d.lienholderId);
  poner('33 First Lien Date if any', d.firstLienDate);
  poner('34 First Lienholder Name if any Mailing Address City State Zip', d.lienholder);

  poner('Permit Number', d.retailerPermitNumber);
  poner('GDN or Lessor Number', d.gdnOrLessorNumber);
  poner('36 TradeIn if any Year Make Vehicle Identification Number', d.tradeIn);
  poner('Additional Trade ins', d.additionalTradeIns);
  poner('Sales and Use Tax', Boolean(d.salesPrice));
  poner('Rebate Amount', d.rebate);
  poner('Sales Price Minus Rebate Amount', d.salesPrice);
  poner('Trade In Amount', d.tradeInAmount);
  poner('Taxable Amount', d.taxableAmount);
  poner('Late Tax Payment Penalty Amount', d.penaltyAmount);
  poner('State Taxes Were Paid To', d.taxPaidToState);
  poner('Amount of Taxes Paid to Previous State', d.taxPaidAmount);
  poner('Amount of Tax and Penalty Due', d.totalDue);
  poner('Exemption claimed under the Motor Vehicle Sales and Use Tax Law because', Boolean(d.exemptionReason));
  poner('Sales Tax Exemption Reason', d.exemptionReason);

  poner(
    'Check if applicable I have physically inspected the vehicle described and verified the vehicle identification number above',
    d.physicallyInspected,
  );
  poner(
    'I certify I am applying for a corrected title and the original Texas Certificate of Title is lost or destroyed',
    d.correctedTitleLost,
  );
  poner('Seller  Name', d.sellerName);
  poner('Applicant Owner', d.applicantName);
  poner('Additional Applicant', d.additionalApplicantName);

  return v;
}
