import type { AppointmentDetail, PatientDto } from '@scanflow/contracts';

/**
 * Opens a plain, printable summary. The identifiers appear in the document body
 * only — never in the window name, the URL, or the title, because those end up
 * in browser history and print-job metadata.
 */
export function printAppointmentSummary(
  detail: AppointmentDetail,
  patient: PatientDto,
  timeZone: string,
): void {
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });

  const lines = [
    'ScanFlow appointment summary',
    '',
    `Patient: ${patient.fullName}`,
    `MRN: ${patient.mrn}`,
    `Date: ${detail.onDate}`,
    `Status: ${detail.status}`,
    '',
    'Segments:',
    ...detail.segments.map((segment) => {
      const label =
        segment.kind === 'DELAY'
          ? `Wait before step ${String(segment.seq)}`
          : `Step ${String(segment.seq)}`;
      const start = clock.format(new Date(segment.patientStart));
      const end = clock.format(new Date(segment.patientEnd));
      return `  ${start}–${end}  ${label}`;
    }),
  ];

  if (detail.notes !== null && detail.notes !== '') {
    lines.push('', `Notes: ${detail.notes}`);
  }

  const popup = window.open('', '_blank', 'width=640,height=720');
  if (popup === null) return;

  popup.document.title = 'Appointment summary';
  const block = popup.document.createElement('pre');
  block.style.font = '14px/1.5 ui-sans-serif, system-ui, sans-serif';
  block.textContent = lines.join('\n');
  popup.document.body.append(block);
  popup.focus();
  popup.print();
}
