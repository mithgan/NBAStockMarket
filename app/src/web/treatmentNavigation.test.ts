import assert from 'node:assert/strict';
import test from 'node:test';
import { treatmentNavigation } from './treatmentNavigation';

test('gallery paths work at root and the Pages base, and return to the same app', () => {
  for (const base of ['/', '/NBAStockMarket/']) {
    const view = treatmentNavigation(`https://example.test${base}treatments/`);
    assert.equal(view.isPreview, true);
    assert.equal(view.appUrl, `https://example.test${base}`);
    assert.equal(new URL(view.galleryUrl).pathname, base);
    assert.equal(new URL(view.galleryUrl).searchParams.has('design'), true);
  }
});

test('query gallery navigation preserves the app path and ordinary query but strips callback fragments', () => {
  const view = treatmentNavigation('https://example.test/NBAStockMarket/?design&keep=yes#access_token=private');
  assert.equal(view.isPreview, true);
  assert.equal(view.appUrl, 'https://example.test/NBAStockMarket/?keep=yes');
  assert.equal(new URL(view.galleryUrl).hash, '');
  assert.equal(treatmentNavigation('https://example.test/NBAStockMarket/').isPreview, false);
});
