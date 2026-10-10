import {
  severityClassToDamageType,
  severityTextToDamageType,
  poiClassesToDamageAreas,
  textToDamageAreas,
  isFlooded,
  isBurn,
  isVandalism,
  isTheft,
  isTotalLoss,
  isSalvageIssue,
} from './keywords';

describe('severityClassToDamageType', () => {
  it('maps the severity-scale class slug to minor/moderate/heavy', () => {
    expect(severityClassToDamageType('very-minor-damage')).toBe('minor');
    expect(severityClassToDamageType('minor-damage')).toBe('minor');
    expect(severityClassToDamageType('minor-to-moderate-damage')).toBe('moderate');
    expect(severityClassToDamageType('moderate-damage')).toBe('moderate');
    expect(severityClassToDamageType('moderate-to-severe-damage')).toBe('heavy');
    expect(severityClassToDamageType(null)).toBeNull();
  });
});

describe('severityTextToDamageType', () => {
  it('maps free-text severity phrasing, maps severe/major to heavy', () => {
    expect(severityTextToDamageType('Accident reported: minor damage')).toBe('minor');
    expect(severityTextToDamageType('Accident reported: moderate damage')).toBe('moderate');
    expect(severityTextToDamageType('Accident reported: severe damage')).toBe('heavy');
    expect(severityTextToDamageType('Vehicle serviced')).toBeNull();
  });
});

describe('poiClassesToDamageAreas', () => {
  it('maps Carfax poi-image diagram tokens to the DamageArea enum', () => {
    expect(poiClassesToDamageAreas('left-rear rear right-rear')).toEqual(
      expect.arrayContaining(['rear_left', 'rear', 'rear_right']),
    );
    expect(poiClassesToDamageAreas('left-front front')).toEqual(expect.arrayContaining(['front_left', 'front']));
    expect(poiClassesToDamageAreas(null)).toEqual([]);
  });
});

describe('textToDamageAreas', () => {
  it('falls back to comment phrasing when there is no diagram', () => {
    expect(textToDamageAreas('Damage to rear')).toEqual(['rear']);
    expect(textToDamageAreas('Vehicle involved in a rear-end collision. Damage to front left.')).toEqual(['front_left']);
    expect(textToDamageAreas('Vehicle serviced, oil changed')).toEqual([]);
  });
});

describe('row-level boolean keyword rules', () => {
  it('only flip true on an explicit textual match', () => {
    expect(isFlooded('Flood damage reported')).toBe(true);
    expect(isFlooded('Vehicle serviced')).toBe(false);
    expect(isBurn('Fire damage reported')).toBe(true);
    expect(isVandalism('Vandalism reported')).toBe(true);
    expect(isTheft('Vehicle reported stolen')).toBe(true);
    expect(isTotalLoss('Vehicle declared a total loss')).toBe(true);
    expect(isSalvageIssue('Salvage title issued')).toBe(true);
    expect(isSalvageIssue('Vehicle serviced')).toBe(false);
  });
});
