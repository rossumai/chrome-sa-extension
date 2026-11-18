// The fictional vendor master the Academy attaches to mission 3. Every name and
// VAT number is invented; `SE556677889901` (Nordic Pallet AB) is the one the
// go-live task tells the trainee to type, so it must stay in this list.
const VENDORS: Array<[string, string, string]> = [
  ['Nordic Pallet AB', 'SE556677889901', 'SE'],
  ['Baltic Crate Works', 'LT100001234567', 'LT'],
  ['Danube Freight Services', 'AT12345678', 'AT'],
  ['Elbe Packaging GmbH', 'DE123456789', 'DE'],
  ['Fjord Logistics AS', 'NO912345678', 'NO'],
  ['Garonne Transports SARL', 'FR12345678901', 'FR'],
  ['Highland Haulage Ltd', 'GB123456789', 'GB'],
  ['Iberia Cargo SL', 'ESB12345678', 'ES'],
  ['Jura Steel Racks SA', 'CHE123456789', 'CH'],
  ['Kraków Forwarding sp. z o.o.', 'PL1234567890', 'PL'],
  ['Lagoon Shipping Srl', 'IT12345678901', 'IT'],
  ['Maas Terminal BV', 'NL123456789B01', 'NL'],
  ['North Sea Fuel NV', 'BE0123456789', 'BE'],
  ['Oder Rail Logistics', 'DE234567891', 'DE'],
  ['Prague Pallet Pool s.r.o.', 'CZ12345678', 'CZ'],
  ['Quay Side Cranes Ltd', 'GB234567891', 'GB'],
  ['Rhône Warehousing SAS', 'FR23456789012', 'FR'],
  ['Saimaa Timber Oy', 'FI12345678', 'FI'],
  ['Tagus Port Services Lda', 'PT123456789', 'PT'],
  ['Uppsala Cold Chain AB', 'SE556677889902', 'SE'],
  ['Vistula Trucking sp. z o.o.', 'PL2345678901', 'PL'],
  ['Wadden Ferries BV', 'NL234567891B01', 'NL'],
  ['Xanten Tyres GmbH', 'DE345678912', 'DE'],
  ['Ystad Container Repair AB', 'SE556677889903', 'SE'],
  ['Zeeland Stevedoring NV', 'BE0234567891', 'BE'],
  ['Alpine Toll Services GmbH', 'AT23456789', 'AT'],
  ['Bothnia Bunkering Oy', 'FI23456789', 'FI'],
  ['Cork Customs Brokers Ltd', 'IE1234567T', 'IE'],
  ['Dalmatia Ro-Ro d.o.o.', 'HR12345678901', 'HR'],
  ['Estonia Trailer Rental OÜ', 'EE123456789', 'EE'],
  ['Flanders Fleet Leasing NV', 'BE0345678912', 'BE'],
  ['Gdańsk Lashing Supplies', 'PL3456789012', 'PL'],
  ['Hanse Insurance Brokers', 'DE456789123', 'DE'],
  ['Inn Valley Diesel GmbH', 'AT34567891', 'AT'],
  ['Jutland Tarpaulins ApS', 'DK12345678', 'DK'],
  ['Kaunas Axle Service UAB', 'LT200001234567', 'LT'],
  ['Loire Forklift Hire SAS', 'FR34567890123', 'FR'],
  ['Moselle Weighbridge Sàrl', 'LU12345678', 'LU'],
  ['Neckar IT Services GmbH', 'DE567891234', 'DE'],
  ['Oslo Fjord Pilots AS', 'NO923456789', 'NO'],
];

const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** `acme-vendors.csv`: a header and 40 rows, ids `V001`…`V040`. */
export function vendorsCsv(): string {
  const rows = VENDORS.map(
    ([name, vat, country], i) =>
      `V${String(i + 1).padStart(3, '0')},${quote(name)},${vat},${country}`,
  );
  return ['id,name,vat_id,country', ...rows].join('\n') + '\n';
}
