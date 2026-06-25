export async function fetchWorkerSource(
  workerUrl: string,
  workerIntegrity: string,
): Promise<string> {
  if (!workerIntegrity) {
    throw new Error('worker_integrity_missing');
  }

  const res = await fetch(workerUrl, {
    credentials: 'omit',
    integrity: workerIntegrity,
  });
  if (!res.ok) {
    throw new Error(`worker_fetch_${res.status}`);
  }
  return res.text();
}
