import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { verifyReceipt, type VerifyResult } from '../../training/receipt.js';
import { hmacSha256 } from '../../training/hmac.js';
import { RECEIPT_KEY } from '../../training/receiptKey.js';
import { track } from '../../usage/track.js';
import css from '../Academy.module.css';

const sign = (msg: string) => hmacSha256(RECEIPT_KEY, msg);

export default function TrainerPanel() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Reads the textarea's live value: a paste followed by an immediate click would
  // otherwise hand check() the previous render's text.
  const check = async () => {
    track('sa_training_receipt_verify');
    setResult(await verifyReceipt(taRef.current?.value ?? text, sign));
  };

  return (
    <section class={css.trainer}>
      <h3 class={css.trainerTitle}>Check a colleague{'’'}s summary</h3>
      <p class={css.fine}>Paste the whole completion summary a trainee sent you.</p>
      <textarea
        ref={taRef}
        class={css.textarea}
        rows={10}
        value={text}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setResult(null);
        }}
      />
      <button type="button" class="btn btn-primary" onClick={check}>
        Check
      </button>
      {/* Naming the person is safe only because canonicalString SIGNS the username. */}
      {result && (
        <p class={result.valid ? css.okNote : css.warnNote}>
          {result.valid
            ? `Valid. Issued to ${result.fields!.username} (id ${result.fields!.userId}) at ${result.fields!.host} on ${result.fields!.dateUtc}, for queue ${result.fields!.queueId}.`
            : 'Not valid. This code does not match its own summary.'}
        </p>
      )}
    </section>
  );
}
