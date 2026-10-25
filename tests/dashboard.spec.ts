import { test, expect } from '@playwright/test';

test('handoff displays actionable sections and refresh requests a fresh generation', async ({ page }) => {
  const briefRequests: { refresh: boolean }[] = [];
  const ids = Array.from({ length: 15 }, (_, index) => `OPC_${String(index + 1).padStart(2, '0')}`);
  await page.route(/\/(health|output|cases\/brief)(\?.*)?$/, async route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path.endsWith('/health')) {
      json = { status: 'ok', training_cases: 2500, authorization_rate: .65, opc_ids: ids, boosting_rounds: 100,
        models: ids.map(opc_id => ({ opc_id, training_cases: 160, authorization_rate: .65, boosting_rounds: 100 })) };
    } else if (path.endsWith('/output')) {
      json = ids.map((opc_id, index) => ({ opc_id, probability: .85 - index * .02 }));
    } else {
      const request = route.request().postDataJSON();
      briefRequests.push(request);
      json = { opc_id: request.opc_id, probability: .85, source: 'groq', source_detail: null, cached: false,
        case_brief: 'This fictional referral needs a coordinated family conversation.\n\nConfirm what has already been discussed before introducing new information.',
        match_rationale: 'The model estimate describes an association; it does not establish family consent.',
        conversation_priorities: ['Ask which questions the family wants addressed.', 'Check understanding before introducing more information.'],
        verify_before_approach: ['Confirm who should be present for the discussion.'] };
    }
    await route.fulfill({ json, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add case', exact: true }).click();
  await page.getByRole('button', { name: 'Create referral', exact: true }).click();
  await page.getByRole('button', { name: 'Generate brief', exact: true }).click();
  await expect(page.locator('.case-brief-copy p')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Conversation priorities' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirm before approach' })).toBeVisible();
  await expect(page.locator('.case-brief-section li')).toHaveCount(3);
  expect(briefRequests[0].refresh).toBe(false);
  await page.getByRole('button', { name: 'Refresh brief', exact: true }).click();
  await expect.poll(() => briefRequests.length).toBe(2);
  expect(briefRequests[1].refresh).toBe(true);
});

for (const staffBusy of [false, true]) {
  test(`completed referral reverts to active with staff ${staffBusy ? 'busy elsewhere' : 'available'}`, async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Add case', exact: true }).click();
    await page.getByRole('button', { name: 'Create referral', exact: true }).click();
    const match = page.locator('.match-row:not(.unavailable)').first();
    const staffName = await match.locator('.match-person strong').evaluate(el => el.firstChild?.textContent || '');
    await match.getByRole('button', { name: 'Assign OPO Staff' }).click();
    await page.getByRole('button', { name: 'Log case outcome' }).click();
    await page.getByRole('button', { name: 'Not authorized Family declined donation' }).click();
    await page.getByLabel('Outcome notes', { exact: false }).fill('Previous outcome notes');
    await page.getByRole('button', { name: 'Submit & update model' }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    if (staffBusy) {
      await page.getByRole('button', { name: 'Add case', exact: true }).click();
      await page.getByRole('button', { name: 'Create referral', exact: true }).click();
      await page.locator('.match-row').filter({ hasText: staffName }).getByRole('button', { name: 'Assign OPO Staff' }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Training Data Loop', exact: true }).click();
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Revert OH-2038 to active', exact: true }).click();
    } else {
      await page.getByRole('button', { name: /^Active Cases/ }).click();
      await page.getByRole('button', { name: 'OH-2038', exact: true }).click();
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name: 'Revert to active', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Authorization declined');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Revert to active', exact: true }).click();
    }

    await expect(page.getByRole('heading', { name: 'Active cases', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(staffBusy ? 'Needs assignment' : 'Staff assigned');
    await expect(page.getByRole('button', { name: 'Revert to active', exact: true })).toHaveCount(0);
    await page.reload();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('relay-opo-state-v1')!));
    const reopened = saved.cases.find((record: { case_id: string }) => record.case_id === 'OH-2038');
    expect(reopened.authorized).toBeNull();
    expect(reopened.consent_obtained).toBeNull();
    expect(reopened.completed_at).toBeUndefined();
    expect(reopened.notes).toBe('');
    expect(reopened.status).toBe(staffBusy ? 'Needs assignment' : 'Staff assigned');
    if (staffBusy) expect(reopened.opc_id).toBeNull();
    else expect(reopened.opc_id).not.toBeNull();
    expect(saved.outcomes.filter((outcome: { source: string }) => outcome.source === 'feedback')).toHaveLength(0);
  });
}

test('referral assignments can be removed from the detail card and case table', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Add case', exact: true }).click();
  await page.getByRole('button', { name: 'Create referral', exact: true }).click();
  const firstMatch = page.locator('.match-row:not(.unavailable)').first();
  const staffName = await firstMatch.locator('.match-person strong').evaluate(el => el.firstChild?.textContent || '');
  await firstMatch.getByRole('button', { name: 'Assign OPO Staff' }).click();
  await expect(page.locator('.assigned-card')).toContainText(staffName);
  const historySize = await page.evaluate(() => JSON.parse(localStorage.getItem('relay-opo-state-v1')!).outcomes.length);

  await page.locator('.assigned-card').getByRole('button', { name: 'Unassign staff', exact: true }).click();
  await expect(page.locator('.assigned-card')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('Needs assignment');
  await expect(page.getByRole('button', { name: 'Log case outcome' })).toBeDisabled();
  const releasedStaff = page.locator('.match-row').filter({ hasText: staffName });
  await expect(releasedStaff.getByRole('button', { name: 'Assign OPO Staff' })).toBeEnabled();
  await releasedStaff.getByRole('button', { name: 'Assign OPO Staff' }).click();
  await expect(page.locator('.assigned-card')).toContainText(staffName);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Active Cases/ }).click();
  await page.getByRole('button', { name: 'Unassign staff from OH-2038', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page.locator('.case-table tbody tr').filter({ hasText: 'OH-2038' });
  await expect(row).toContainText('Needs assignment');
  await expect(row.getByRole('button', { name: 'Unassign staff from OH-2038' })).toHaveCount(0);
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('relay-opo-state-v1')!));
  expect(saved.cases.find((record: { case_id: string }) => record.case_id === 'OH-2038').opc_id).toBeNull();
  expect(saved.outcomes).toHaveLength(historySize);
});

test('dashboard renders, filters keep input focus, map and responsive navigation work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('Page error:', error.message); });
  page.on('console', message => { if (message.type() === 'error' && message.text().startsWith('ProcureLink map error:')) errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/relay-dashboard.png', fullPage: true });
  const search = page.getByRole('textbox', { name: 'Search cases', exact: true });
  await search.pressSequentially('OH-2026');
  await expect(search).toBeFocused();
  await expect(page.locator('.case-table tbody tr')).toHaveCount(1);
  await search.fill('');
  await page.getByLabel('Filter by hospital', { exact: true }).selectOption('toledo');
  await expect(page.locator('.case-table tbody tr')).toHaveCount(3);
  await page.getByLabel('Filter by hospital', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Family emotional state').selectOption('Angered / Defensive');
  await expect(page.locator('.case-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('procurelink-referred-cases.csv');
  await page.getByRole('button', { name: 'Map View', exact: true }).click();
  await page.getByRole('button', { name: 'Show Miami Valley Hospital cases', exact: true }).click();
  await expect(page.locator('.hospital-popover')).toContainText('Miami Valley Hospital');
  await page.locator('.hospital-case-list button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Staff Analytics', exact: true }).click();
  await expect(page.locator('.staff-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/relay-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Training Data Loop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every outcome, a better next step.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('new case → assign → declined → similar case → different staff → authorized persists and changes estimates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New referral', exact: true }).click();
  await page.getByLabel('Age', { exact: true }).fill('44');
  await page.getByLabel('Family emotional state').selectOption('Shutdown / Stoic');
  await page.getByRole('button', { name: 'Create referral', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('OH-2038');
  const firstMatch = page.locator('.match-row:not(.unavailable)').first();
  const firstName = await firstMatch.locator('.match-person strong').evaluate(el => el.firstChild?.textContent || '');
  await firstMatch.getByRole('button', { name: 'Assign OPO Staff' }).click();
  await expect(page.locator('.assigned-card')).toContainText(firstName);
  await page.screenshot({ path: '/tmp/relay-matcher.png', fullPage: true });
  await page.getByRole('button', { name: 'Log case outcome' }).click();
  await page.getByRole('button', { name: 'Not authorized', exact: false }).click();
  await page.getByLabel('Outcome notes', { exact: false }).fill('Family declined. Test an alternate match on similar context.');
  await page.getByRole('button', { name: 'Submit & update model' }).click();
  await expect(page.getByRole('heading', { name: 'Every outcome teaches us.' })).toBeVisible();
  let history = await page.evaluate(() => JSON.parse(localStorage.getItem('relay-opo-state-v1')!).outcomes.filter((o: { source: string }) => o.source === 'feedback'));
  expect(history).toHaveLength(1);
  expect(history[0].after).toBeLessThan(history[0].before);
  await page.getByRole('button', { name: 'Try a similar case' }).click();
  await expect(page.getByLabel('Age', { exact: true })).toHaveValue('44');
  await page.getByRole('button', { name: 'Create referral', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('OH-2039');
  const secondMatch = page.locator('.match-row:not(.unavailable)').filter({ hasNotText: firstName }).first();
  await secondMatch.getByRole('button', { name: 'Assign OPO Staff' }).click();
  await page.getByRole('button', { name: 'Log case outcome' }).click();
  await page.getByRole('button', { name: 'Authorized Family agreed to donation', exact: true }).click();
  await expect(page.getByLabel('Consent documentation obtained')).toBeChecked();
  await page.getByRole('button', { name: 'Submit & update model' }).click();
  await expect(page.getByRole('heading', { name: 'Every outcome teaches us.' })).toBeVisible();
  await page.screenshot({ path: '/tmp/relay-feedback.png', fullPage: true });
  history = await page.evaluate(() => JSON.parse(localStorage.getItem('relay-opo-state-v1')!).outcomes.filter((o: { source: string }) => o.source === 'feedback'));
  expect(history).toHaveLength(2);
  expect(history[1].after).toBeGreaterThan(history[1].before);
  expect(history[1].staffId).not.toBe(history[0].staffId);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Training Data Loop', exact: true }).click();
  await expect(page.locator('.training-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.learning-total').last()).toContainText('+2');
});
