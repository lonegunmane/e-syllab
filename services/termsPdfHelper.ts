/**
 * Terms of Use PDF Helper for Chinsali Girls Secondary School
 * Zambia Data Protection Act No. 3 of 2021 & Platform Guidelines Compliance
 */

export async function downloadTermsPdf(): Promise<void> {
  const filename = 'Chinsali_Girls_Secondary_School_Terms_of_Use.pdf';

  try {
    const response = await fetch('/api/terms/pdf');
    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return;
    }
  } catch (err) {
    console.warn('[termsPdfHelper] Backend PDF fetch failed, using client fallback:', err);
  }

  // Pure client PDF generation fallback (standard PDF 1.4)
  generateClientTermsPdf(filename);
}

function generateClientTermsPdf(filename: string): void {
  const sections = [
    {
      title: '1. Acceptance of Educational Terms',
      text: 'By accessing E-SYLLAB at Chinsali Girls Secondary School, students, teachers, and staff agree to school regulations and platform terms.'
    },
    {
      title: '2. Permitted Use & Account Responsibility',
      text: 'Every member is issued individual credentials. Sharing credentials or impersonating others is prohibited. Users are responsible for records submitted.'
    },
    {
      title: '3. Academic Integrity & Authenticity',
      text: 'Attendance entries and academic grades are official school records. Unauthorized alteration or falsification constitutes serious misconduct.'
    },
    {
      title: '4. Data Protection & Privacy',
      text: 'Complies with Zambia Data Protection Act No. 3 of 2021. Student records are private and used solely for lawful school purposes.'
    },
    {
      title: '5. Curriculum Standards',
      text: 'Curriculum resources align with the Examinations Council of Zambia (ECZ) national secondary syllabus.'
    },
    {
      title: '6. Offline Continuity & Synchronization',
      text: 'Local offline storage ensures seamless school operations during network interruptions, syncing automatically when reconnected.'
    },
    {
      title: '7. School Inquiries & Contact',
      text: 'Administration Office, Chinsali Girls Secondary School, Chinsali, Muchinga Province, Zambia.'
    }
  ];

  const streamLines: string[] = [
    'BT',
    '/F1 16 Tf',
    '50 780 Td',
    '(Chinsali Girls Secondary School) Tj',
    '/F2 10 Tf',
    '0 -18 Td',
    '(Terms of Use & Platform Guidelines - Chinsali, Zambia) Tj',
    '0 -24 Td'
  ];

  sections.forEach(s => {
    streamLines.push('/F1 11 Tf', `(${escapePdfText(s.title)}) Tj`, '/F2 9.5 Tf', '0 -14 Td', `(${escapePdfText(s.text)}) Tj`, '0 -18 Td');
  });

  streamLines.push('/F2 8.5 Tf', '0 -10 Td', '(Official Document - Chinsali Girls Secondary School, Zambia) Tj', 'ET');
  const streamData = streamLines.join('\n');
  const streamLen = new TextEncoder().encode(streamData).length;

  const pdfContent = `%PDF-1.4
1 0 obj
<</Type /Catalog /Pages 2 0 R>>
endobj
2 0 obj
<</Type /Pages /Kids [3 0 R] /Count 1>>
endobj
3 0 obj
<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R /F2 5 0 R>>>> /Contents 6 0 R>>
endobj
4 0 obj
<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold>>
endobj
5 0 obj
<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>
endobj
6 0 obj
<</Length ${streamLen}>>
stream
${streamData}
endstream
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000318 00000 n 
0000000387 00000 n 
trailer
<</Size 7 /Root 1 0 R>>
startxref
${450 + streamLen}
%%EOF`;

  const blob = new Blob([pdfContent], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function escapePdfText(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
