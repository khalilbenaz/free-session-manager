'use strict';
/**
 * Master Test Runner: Security, Performance, and Non-Regression
 */

const { runSecurityTests } = require('./security-tests');
const { runPerformanceTests } = require('./performance-tests');
const { runRegressionTests } = require('./regression-tests');
const { runDirectProviderTests } = require('./direct-provider-tests');

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('🧪 SUITE DE TESTS GLOBALE : SÉCURITÉ • PERFORMANCE • NON-RÉGRESSION');
  console.log('════════════════════════════════════════════════════════════════════════════');

  const startTotal = Date.now();

  const sec = await runSecurityTests();
  const perf = await runPerformanceTests();
  const reg = await runRegressionTests();
  const dp = await runDirectProviderTests();

  const totalPassed = sec.passed + perf.passed + reg.passed + dp.passed;
  const totalFailed = sec.failed + perf.failed + reg.failed + dp.failed;
  const totalDuration = ((Date.now() - startTotal) / 1000).toFixed(2);

  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log(`🏁 RÉSULTATS GLOBAUX :`);
  console.log(`   • Tests réussis : \x1b[32m${totalPassed}\x1b[0m`);
  console.log(`   • Tests échoués : ${totalFailed > 0 ? `\x1b[31m${totalFailed}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
  console.log(`   • Durée totale  : ${totalDuration}s`);
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Erreur critique pendant l\'exécution des tests :', err);
  process.exit(1);
});
