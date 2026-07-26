(function () {
  const documents = {
    terms: {
      title: 'Terms of Use',
      intro: 'Rules for using the current Ace Staker demonstration platform.',
      sections: [
        ['Demo-only service', 'Ace Staker currently uses non-transferable demonstration credits. It does not accept deposits, process withdrawals, or offer cash prizes.'],
        ['Eligibility', 'Users must be at least 18 years old. Access may be restricted or withdrawn when an account is misused, automated, compromised, or used to interfere with the service.'],
        ['Accounts', 'Keep your password confidential and provide accurate account information. Demo balances, offers, and features may be corrected when caused by an error or test configuration.'],
        ['No gambling authorization', 'This demonstration does not represent a gaming licence, legal approval, or authorization to accept real-money wagers in any jurisdiction.'],
        ['Changes and availability', 'Features, markets, demonstration balances, and these terms may change while the product is being developed.']
      ]
    },
    privacy: {
      title: 'Privacy Notice',
      intro: 'How account and product-use information is handled in the demonstration.',
      sections: [
        ['Information collected', 'The demo stores an email-based account, display name, age confirmation, demo wallet activity, wagers, responsible-play settings, support messages, and security or audit events.'],
        ['How it is used', 'Information supports authentication, demo wallet accounting, bet history, customer support, safety controls, troubleshooting, and administrative oversight.'],
        ['Service providers', 'The current build uses Supabase for authentication and data storage and Vercel for web hosting. Their processing is subject to their own contractual and privacy terms.'],
        ['Retention and control', 'Production retention periods and formal access/deletion procedures must be approved before launch. Contact support for a request concerning the current demo account.'],
        ['No payment or KYC data', 'The current release does not collect payment cards, bank details, identity documents, or location-verification records.']
      ]
    },
    rules: {
      title: 'Betting Rules',
      intro: 'Settlement and wallet rules for demonstration-credit wagers.',
      sections: [
        ['Odds and placement', 'Displayed decimal odds may change. A wager is accepted only after the server validates the selection, market state, stake limits, and demo balance. The accepted odds are saved with each bet leg.'],
        ['Singles and parlays', 'A single contains one selection. A parlay combines two or more selections from different events and requires every non-void leg to win.'],
        ['Settlement', 'Administrators settle demonstration events as won, lost, or void. Winning payouts and void refunds are written to the immutable demo-wallet ledger.'],
        ['Cash-out', 'Eligible pending demo bets may receive a server-calculated cash-out offer. Accepting it ends the wager and replaces any later event payout. Offers are not guaranteed.'],
        ['Errors and interruptions', 'Obvious data, pricing, settlement, or configuration errors may be corrected. Real feed interruption procedures must be agreed with a licensed data provider before real-money launch.']
      ]
    },
    responsible: {
      title: 'Responsible Play',
      intro: 'Tools and practical guidance for keeping play controlled.',
      sections: [
        ['Set boundaries', 'Use the daily stake limit and session reminders before placing bets. Never treat gambling as income or a way to recover losses.'],
        ['Take a break', 'Self-exclusion blocks new bets for the selected period and cannot be shortened from the site. For urgent help, stop playing and contact an appropriate professional support organization in your country.'],
        ['Warning signs', 'Chasing losses, borrowing money, hiding activity, missing work or study, and feeling unable to stop are signs to seek help.'],
        ['Protect minors', 'Ace Staker is intended only for adults aged 18 or older. Do not share account access or devices with minors.'],
        ['Current demo status', 'Although the platform uses demonstration credits, responsible-play limits remain available so the product can be tested with safety controls from the beginning.']
      ]
    }
  };

  const key = document.body.dataset.legal;
  const doc = documents[key];
  const root = document.getElementById('legalContent');
  if (!doc || !root) return;
  root.innerHTML = `
    <section class="legal-hero"><span class="tier-chip">ACE STAKER POLICY</span>
      <h1>${doc.title}</h1><p>${doc.intro}</p><small>Last updated: July 25, 2026</small></section>
    ${doc.sections.map(([title, text]) => `<section class="legal-card"><h2>${title}</h2><p>${text}</p></section>`).join('')}
    <section class="legal-card"><h2>Questions</h2><p>Use the <a href="help.html">Support Center</a> for questions about these policies or the demo account.</p></section>`;
})();