import { scrapeCarfaxHtml } from './carfax-html';

/**
 * Minimal synthetic Carfax HTML fixture — not a real report — covering the
 * structural selectors documented in scrape-findings.md: one owner tab, one
 * damage record with its severity/location detail row, one plain service
 * record, and the top-level summary phrases the signals regexes key off of.
 */
function buildFixture(opts: { brandedTitle: boolean } = { brandedTitle: false }): string {
  const titleLegend = opts.brandedTitle
    ? 'Damage BrandsSalvage | Junk | Rebuilt | Fire | Flood | Hail | LemonAlert!Problem Found'
    : 'Damage BrandsSalvage | Junk | Rebuilt | Fire | Flood | Hail | LemonNo Problem';
  return `<html><body>
    <div>carfax value$8,500 12 Service History Records 1 Previous Owners Personal Vehicle
    Owned in the following states/provincesTexasEstimated miles driven per year 10,000
    No open recalls reported to CARFAX. ${titleLegend}</div>
    <div class="owner-tab"><div class="ownership-text">
      <h3 class="ownership-label">Owner 1</h3>
      <div class="purchase-year"><span>Purchased:</span> 2020</div>
      <div class="owner-type">Personal</div>
    </div></div>
    <table>
    <tr class="detailed-history-row detailed-history-row-main">
      <td class="record-normal-first-column">01/15/2021</td>
      <td class="record-odometer-reading">10,000</td>
      <td class="record-source"><p class="detail-record-source-line">Texas DMV</p></td>
      <td class="record-icon"></td>
      <td class="record-comments"><ul class="record-comments-groups"><li class="record-comments-group">
        <strong class="comments-group-outer-line">Accident reported: minor damage</strong>
        <ul class="record-comments-group-inner-lines">
          <li class="record-comments-group-inner-line">Damage to rear</li>
        </ul>
      </li></ul></td>
    </tr>
    <tr class="detailed-history-row detailed-history-row-supplementary">
      <td colspan="3"><div class="severity-scale minor-damage"></div>
      <div class="poi-image rear"><svg aria-label="Image showing damage to the following vehicle areas: rear"></svg></div></td>
    </tr>
    <tr class="detailed-history-row detailed-history-row-main">
      <td class="record-normal-first-column">06/01/2021</td>
      <td class="record-odometer-reading">15,000</td>
      <td class="record-source"><p class="detail-record-source-line">Independent Service Shop</p></td>
      <td class="record-icon"></td>
      <td class="record-comments"><ul class="record-comments-groups"><li class="record-comments-group">
        <strong class="comments-group-outer-line">Vehicle serviced</strong>
        <ul class="record-comments-group-inner-lines">
          <li class="record-comments-group-inner-line">Oil and filter changed, front brake pads replaced</li>
        </ul>
      </li></ul></td>
    </tr>
    </table>
  </body></html>`;
}

describe('scrapeCarfaxHtml', () => {
  it('groups detailed-history rows under their owner and extracts top-level scalars', () => {
    const report = scrapeCarfaxHtml(buildFixture());
    expect(report.owners_history).toHaveLength(1);
    const owner = report.owners_history[0];
    expect(owner.owner_no).toBe(1);
    expect(owner.purchased).toBe('2020-01-01');
    expect(owner.type_of_owner).toBe('Personal');
    expect(owner.history_table).toHaveLength(2);

    expect(report.millage).toBe(15000);
    expect(report.value).toBe(8500);
    expect(report.service_history_record).toBe(12);
    expect(report.at_last_open_recall).toBe(0);
    expect(report.last_owner_state).toBe('TX');
    expect(report.title).toBe('Clean Title');
  });

  it('reads damage severity/location off the supplementary detail row, not off plain service comments', () => {
    const report = scrapeCarfaxHtml(buildFixture());
    const [damageRow, serviceRow] = report.owners_history[0].history_table;

    expect(damageRow.damage_type).toBe('minor');
    expect(damageRow.if_damage).toEqual(['rear']);

    // "front brake pads replaced" must NOT be mistaken for front-end damage.
    expect(serviceRow.damage_type).toBeNull();
    expect(serviceRow.if_damage).toBeNull();
  });

  it('defaults an unspecified-but-flagged title brand to Salvage Title', () => {
    const report = scrapeCarfaxHtml(buildFixture({ brandedTitle: true }));
    expect(report.title).toBe('Salvage Title');
  });

  it('flags accident=true for a plain "Accident reported"/"Total Loss"/"Air Bag Deployed" row with no severity-scale/poi-image detail panel', () => {
    const html = `<html><body>
      <div>carfax value$1,000 1 Service History Records No open recalls reported to CARFAX.</div>
      <div class="owner-tab"><div class="ownership-text"><h3 class="ownership-label">Owner 1</h3></div></div>
      <table>
      <tr class="detailed-history-row detailed-history-row-main">
        <td class="record-normal-first-column">03/01/2024</td>
        <td class="record-odometer-reading">5,000</td>
        <td class="record-source"></td><td class="record-icon"></td>
        <td class="record-comments"><ul class="record-comments-groups"><li class="record-comments-group">
          <strong class="comments-group-outer-line">Accident reported</strong>
        </li></ul></td>
      </tr>
      <tr class="detailed-history-row detailed-history-row-main">
        <td class="record-normal-first-column">04/01/2024</td>
        <td class="record-odometer-reading">5,100</td>
        <td class="record-source"></td><td class="record-icon"></td>
        <td class="record-comments"><ul class="record-comments-groups"><li class="record-comments-group">
          <strong class="comments-group-outer-line">Vehicle Reported as Total Loss</strong>
        </li></ul></td>
      </tr>
      </table>
    </body></html>`;
    const report = scrapeCarfaxHtml(html);
    expect(report.accident).toBe(true);
    expect(report.owners_history[0].history_table[0].damage_type).toBeNull(); // no severity text/panel — still counts as an accident.
  });

  it('reads type_of_owner from .ownership-right (a sibling of the label/purchase-year, not a descendant of it)', () => {
    const html = `<html><body>
      <div>carfax value$1,000 1 Service History Records No open recalls reported to CARFAX.</div>
      <div class="owner-tab">
        <div class="ownership-left"><div class="ownership-text">
          <h3 class="ownership-label">Owner 1</h3>
          <div class="purchase-year"><span>Purchased:</span> 2022</div>
        </div></div>
        <div class="ownership-right"><div class="owner-type"><span>Commercial Vehicle</span></div></div>
      </div>
      <table></table>
    </body></html>`;
    const report = scrapeCarfaxHtml(html);
    expect(report.owners_history[0].type_of_owner).toBe('Commercial Vehicle');
    expect(report.owners_history[0].purchased).toBe('2022-01-01');
  });

  it('reads the visible (aria-hidden=true) source span, not the duplicated visually-hidden one, and drops phone/URL/Title# noise', () => {
    const html = `<html><body>
      <div>carfax value$1,000 1 Service History Records No open recalls reported to CARFAX.</div>
      <div class="owner-tab"><div class="ownership-text"><h3 class="ownership-label">Owner 1</h3></div></div>
      <table>
      <tr class="detailed-history-row detailed-history-row-main">
        <td class="record-normal-first-column">08/31/2022</td>
        <td class="record-odometer-reading">158</td>
        <td class="record-source">
          <p class="detail-record-source-line"><span class="visually-hidden do-not-print">Stockton, Georgia</span><span aria-hidden="true">Georgia</span></p>
          <p class="detail-record-source-line"><span class="visually-hidden do-not-print">Stockton, Georgia</span><span aria-hidden="true">Motor Vehicle Dept.</span></p>
          <p class="detail-record-source-line"><span class="visually-hidden do-not-print">Stockton, Georgia</span><span aria-hidden="true">Stockton, GA</span></p>
          <p class="detail-record-source-line"><span class="visually-hidden do-not-print">Title Number 123</span><span class="visually-hidden do-not-print">Stockton, Georgia</span><span aria-hidden="true">Title #123</span></p>
        </td>
        <td class="record-icon"></td>
        <td class="record-comments"></td>
      </tr>
      <tr class="detailed-history-row detailed-history-row-main">
        <td class="record-normal-first-column">06/22/2023</td>
        <td class="record-odometer-reading">12,599</td>
        <td class="record-source">
          <p class="detail-record-source-line">Quality Tire Pros</p>
          <p class="detail-record-source-line"><span class="visually-hidden do-not-print">Chattanooga, Tennessee</span><span aria-hidden="true">Chattanooga, TN</span></p>
          <p class="detail-record-source-line"><span class="visually-hidden do-not-print">Chattanooga, Tennessee</span><span aria-hidden="true">423-267-9715</span></p>
          <p class="detail-record-source-line">qualitytirepros.com/</p>
        </td>
        <td class="record-icon"></td>
        <td class="record-comments"></td>
      </tr>
      </table>
    </body></html>`;
    const report = scrapeCarfaxHtml(html);
    const [row1, row2] = report.owners_history[0].history_table;

    expect(row1.source).toBe('Georgia, Motor Vehicle Dept., Stockton, GA');
    expect(row1.millage).toBe(158);

    expect(row2.source).toBe('Quality Tire Pros, Chattanooga, TN');
    expect(row2.millage).toBe(12599);
  });

  it('picks the most recent *dated* title-brand event over fixed priority (salvage then rebuilt => Rebuilt Title)', () => {
    const html = `<html><body>
      <div>carfax value$1,000 1 Service History Records No open recalls reported to CARFAX.</div>
      <div class="owner-tab"><div class="ownership-text"><h3 class="ownership-label">Owner 1</h3></div></div>
      <table>
      <tr class="detailed-history-row detailed-history-row-main">
        <td class="record-normal-first-column">11/21/2025</td>
        <td class="record-odometer-reading"></td>
        <td class="record-source"></td><td class="record-icon"></td>
        <td class="record-comments"><ul class="record-comments-groups"><li class="record-comments-group">
          <strong class="comments-group-outer-line">New owner reportedSALVAGE TITLE/CERTIFICATE ISSUED</strong>
        </li></ul></td>
      </tr>
      <tr class="detailed-history-row detailed-history-row-main">
        <td class="record-normal-first-column">01/22/2026</td>
        <td class="record-odometer-reading"></td>
        <td class="record-source"></td><td class="record-icon"></td>
        <td class="record-comments"><ul class="record-comments-groups"><li class="record-comments-group">
          <strong class="comments-group-outer-line">Dealer took title of this vehicle while it was in inventoryREBUILT TITLE ISSUED</strong>
        </li></ul></td>
      </tr>
      </table>
    </body></html>`;
    const report = scrapeCarfaxHtml(html);
    expect(report.title).toBe('Rebuilt Title');
  });
});
