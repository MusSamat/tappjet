import { describe, expect, it } from 'vitest';
import { foldCyrillic, latinToCyrillic, layoutToCyrillic } from './translit.js';

describe('latinToCyrillic', () => {
  it('транслитерирует привычные написания городов', () => {
    expect(latinToCyrillic('bishkek')).toBe('бишкек');
    expect(latinToCyrillic('jalal-abad')).toBe('жалал-абад');
    expect(latinToCyrillic('uzgen')).toBe('узген');
    expect(latinToCyrillic('cholpon-ata')).toBe('чолпон-ата');
    expect(latinToCyrillic('balykchy')).toBe('балыкчы');
  });
});

describe('layoutToCyrillic', () => {
  it('конвертирует набор в английской раскладке, включая шифт-пунктуацию', () => {
    expect(layoutToCyrillic(',birtr')).toBe('бишкек');
    expect(layoutToCyrillic('<birtr')).toBe('бишкек');
    expect(layoutToCyrillic('ji')).toBe('ош');
    expect(layoutToCyrillic('rfhfrjk')).toBe('каракол');
  });
});

describe('foldCyrillic', () => {
  it('сводит KG-буквы к RU-виду для сравнения', () => {
    expect(foldCyrillic('Өзгөн')).toBe('озгон');
    expect(foldCyrillic('Ысык-Көл')).toBe('ысык-кол');
  });
});
