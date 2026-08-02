// lib/dates.js için testler — özellikle weekKey'in ISO 8601 hafta hesabı sessizce
// yanlış olursa haftalık görevler yanlış zamanda sıfırlanır; bu yüzden sınır
// durumları ezberden değil, ISO 8601 kuralına göre doğrulanarak yazıldı:
// "haftanın Perşembesi hangi takvim yılındaysa hafta o yıla aittir".
import { trIndex, pad, dateKey, weekKey, dayOfYear } from '../dates';

describe('trIndex', () => {
  test('Pazartesi = 0', () => {
    expect(trIndex(new Date(2026, 0, 5))).toBe(0); // 5 Ocak 2026 Pazartesi
  });
  test('Pazar = 6 (JS getDay() 0 döner, trIndex 6\'ya çevirmeli)', () => {
    expect(trIndex(new Date(2026, 0, 4))).toBe(6); // 4 Ocak 2026 Pazar
  });
  test('Perşembe = 3', () => {
    expect(trIndex(new Date(2026, 0, 1))).toBe(3); // 1 Ocak 2026 Perşembe
  });
});

describe('pad', () => {
  test('tek haneli sayıyı sıfırla doldurur', () => {
    expect(pad(5)).toBe('05');
  });
  test('iki haneli sayıyı değiştirmez', () => {
    expect(pad(12)).toBe('12');
  });
  test('0 için de sıfır dolgusu uygular', () => {
    expect(pad(0)).toBe('00');
  });
});

describe('dateKey', () => {
  test('ay ve günü sıfırla dolduruyor (2026-01-05)', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  test('çift haneli ay/gün için dolgu eklemiyor', () => {
    expect(dateKey(new Date(2026, 10, 23))).toBe('2026-11-23');
  });
  test('yıl sonu (31 Aralık)', () => {
    expect(dateKey(new Date(2025, 11, 31))).toBe('2025-12-31');
  });
});

describe('dayOfYear', () => {
  test('1 Ocak = 1', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1);
  });
  test('artık yılda 29 Şubat = 60. gün', () => {
    expect(dayOfYear(new Date(2024, 1, 29))).toBe(60);
  });
  test('artık olmayan yılda 1 Mart = 60. gün (Şubat 28 gün)', () => {
    expect(dayOfYear(new Date(2025, 2, 1))).toBe(60);
  });
  test('artık yılda 1 Mart = 61. gün (29 Şubat sonrası)', () => {
    expect(dayOfYear(new Date(2024, 2, 1))).toBe(61);
  });
  test('31 Aralık = 365 (artık olmayan yıl)', () => {
    expect(dayOfYear(new Date(2025, 11, 31))).toBe(365);
  });
  test('31 Aralık = 366 (artık yıl)', () => {
    expect(dayOfYear(new Date(2024, 11, 31))).toBe(366);
  });
});

describe('weekKey — ISO 8601 hafta hesabı', () => {
  // ISO 8601: bir haftanın ait olduğu yıl, o haftanın Perşembe gününün
  // takvim yılıdır. Yıl dönümündeki sınır vakaları bu yüzden kritik.

  test('yıl dönümü: 29 Aralık 2025 (Pazartesi) → 2026-W01 (o haftanın Perşembesi 1 Ocak 2026)', () => {
    expect(weekKey(new Date(2025, 11, 29))).toBe('2026-W01');
  });

  test('1 Ocak 2026 (Perşembe) da aynı haftada, 2026-W01', () => {
    expect(weekKey(new Date(2026, 0, 1))).toBe('2026-W01');
  });

  test('1 Ocak 2021 (Cuma) → 2020-W53 (o haftanın Perşembesi 31 Aralık 2020)', () => {
    expect(weekKey(new Date(2021, 0, 1))).toBe('2020-W53');
  });

  test('31 Aralık 2020 (Perşembe) da 2020-W53', () => {
    expect(weekKey(new Date(2020, 11, 31))).toBe('2020-W53');
  });

  test('1 Ocak 2024 (Pazartesi) → 2024-W01 (o haftanın Perşembesi 4 Ocak 2024, aynı yıl)', () => {
    expect(weekKey(new Date(2024, 0, 1))).toBe('2024-W01');
  });

  test('artık yıl içinde: 29 Şubat 2024 (Perşembe) → 2024-W09', () => {
    expect(weekKey(new Date(2024, 1, 29))).toBe('2024-W09');
  });

  test('53 haftalık yıl: 31 Aralık 2026 (Perşembe) → 2026-W53', () => {
    expect(weekKey(new Date(2026, 11, 31))).toBe('2026-W53');
  });

  test('Pazar/Pazartesi sınırı: aynı ISO haftasındaki Pazar ve bir sonraki Pazartesi farklı haftalara düşer', () => {
    // 4 Ocak 2026 Pazar, 5 Ocak 2026 Pazartesi — ISO haftası Pazartesi başlar
    const sunday = weekKey(new Date(2026, 0, 4));
    const monday = weekKey(new Date(2026, 0, 5));
    expect(sunday).not.toBe(monday);
    expect(sunday).toBe('2026-W01'); // 4 Ocak'ın haftası (29 Ara - 4 Oca), Perşembesi 1 Oca 2026
    expect(monday).toBe('2026-W02');
  });

  test('hafta numarası her zaman iki haneli sıfır dolgulu', () => {
    expect(weekKey(new Date(2026, 0, 5))).toMatch(/^\d{4}-W\d{2}$/);
  });
});
