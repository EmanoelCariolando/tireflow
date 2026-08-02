import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runner = readFileSync(
  path.join(process.cwd(), 'scripts', 'run-scheduled-backup.ps1'),
  'utf8'
);
const installer = readFileSync(
  path.join(process.cwd(), 'scripts', 'install-daily-backup-task.ps1'),
  'utf8'
);
const remover = readFileSync(
  path.join(process.cwd(), 'scripts', 'remove-daily-backup-task.ps1'),
  'utf8'
);

test('scheduled backup validates branch and external destination without controlling services', () => {
  assert.match(runner, /ExpectedBranchName/);
  assert.match(runner, /BRANCH_NAME/);
  assert.match(runner, /BACKUP_ROOT/);
  assert.match(runner, /NODE_ENV=production/);
  assert.match(runner, /Get-Service -Name \$ServiceName/);
  assert.doesNotMatch(runner, /Stop-Service/);
  assert.doesNotMatch(runner, /Start-Service/);
  assert.doesNotMatch(runner, /WaitForStatus/);
  assert.doesNotMatch(runner, /Stop-Process/);
  assert.doesNotMatch(runner, /Get-Service\s*\|/);
});

test('scheduled backup uses the live database snapshot and verifies its result', () => {
  assert.match(runner, /dist\\database\\backup\.js/);
  assert.match(runner, /backup ao vivo/);
  assert.match(runner, /Backup concluído e verificado/);
  assert.match(runner, /backup-manifest\.json/);
  assert.match(runner, /manifest\.branchName/);
  assert.match(runner, /exit 1/);
});

test('task installer runs daily as SYSTEM and rejects accidental replacement', () => {
  assert.match(installer, /New-ScheduledTaskTrigger -Daily/);
  assert.match(installer, /UserId 'SYSTEM'/);
  assert.match(installer, /LogonType ServiceAccount/);
  assert.match(installer, /RunLevel Highest/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /StartWhenAvailable/);
  assert.match(installer, /\$existingTask -and -not \$Replace/);
  assert.match(installer, /ExecutionTimeLimit \(New-TimeSpan -Minutes 30\)/);
});

test('scheduled backup scripts support Windows PowerShell 5.1 path validation', () => {
  for (const script of [runner, installer]) {
    assert.match(script, /Test-IsFullyQualifiedWindowsPath/);
    assert.doesNotMatch(script, /IsPathFullyQualified/);
  }
  assert.doesNotMatch(remover, /IsPathFullyQualified/);
});

test('task removal is explicit and preserves all operational files', () => {
  assert.match(remover, /ConfirmRemoval/);
  assert.match(remover, /Unregister-ScheduledTask/);
  assert.doesNotMatch(remover, /Remove-Item/);
  assert.doesNotMatch(remover, /Remove-Service/);
});
