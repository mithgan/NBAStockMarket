import assert from 'node:assert/strict';
import test from 'node:test';

import { oauthRedirectUrl } from './oauthRedirect';

test('OAuth returns to the deployed app path', () => {
  assert.equal(
    oauthRedirectUrl({ origin: 'https://mithgan.github.io', pathname: '/NBAStockMarket/' }),
    'https://mithgan.github.io/NBAStockMarket/',
  );
  assert.equal(
    oauthRedirectUrl({ origin: 'https://nba-stock.example.com', pathname: '/' }),
    'https://nba-stock.example.com/',
  );
});

test('OAuth cannot turn a protocol-relative path into an off-origin callback', () => {
  assert.equal(
    oauthRedirectUrl({ origin: 'https://mithgan.github.io', pathname: '//attacker.example/callback' }),
    'https://mithgan.github.io/attacker.example/callback',
  );
});
