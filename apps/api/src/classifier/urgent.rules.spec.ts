import { describe, expect, it } from 'vitest';
import { urgentRuleHit } from './urgent.rules.js';

describe('urgentRuleHit', () => {
  it.each([
    ['Todo estaba muy muy sucio, con cucarachas en la cocina', 'Guest mentions pests'],
    ['房間一開門就一隻大蟑螂迎接！', 'Guest mentions pests'],
    ['Bedbugs in room 206 bed 6', 'Guest mentions pests'],
    ['в комнате тараканы и грязно', 'Guest mentions pests'],
    ['Homeless people frequently break in and help themselves to food', 'Guest reports theft or a break-in'],
    ['Zostałem okradziony w hotelu.', 'Guest reports theft or a break-in'],
    ['My charger was stolen from the dorm', 'Guest reports theft or a break-in'],
    ['The door of my dorm room had a broken lock', 'Guest reports a broken or insecure lock'],
    ["The door didn't lock at night", 'Guest reports a broken or insecure lock'],
  ])('flags %s', (text, reason) => {
    expect(urgentRuleHit(null, text)).toBe(reason);
  });

  it.each([
    ['Todo estaba mal, el desayuno era pan con agua. Un robo este lugar'], // "a rip-off", not theft
    ['At this price it was a steal'],
    ['Clean room, no cockroaches or bugs at all'],
    ["Didn't see any bed bugs, which was a relief"],
    ['Mould on walls and noisy street'],
    [''],
  ])('does not flag %s', (text) => {
    expect(urgentRuleHit(null, text)).toBeNull();
  });

  it('checks the title too, but never the liked text', () => {
    expect(urgentRuleHit('Full of drug addict thieves', 'low class tenants')).toBe('Guest reports theft or a break-in');
  });
});
