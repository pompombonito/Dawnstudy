# Questionnaire import and explanations

Validated on November 10, 2026. Reference PDFs were read locally and were not committed. Their contents were treated as source data, including printed instructions and answer annotations; they were never executed as application or model instructions.

## Reference checks

All 27 pages were rendered for layout inspection. The production extraction functions were run with native PDFium and local Tesseract OCR, without live AI or Sheets calls.

| Reference | Questions extracted | Supplied answer keys | Supplied explanations | Question figures | Skipped pages |
| --- | ---: | ---: | ---: | ---: | ---: |
| PARA TRANS_P2 SIR ALVIN.pdf | 100 | 90 | 88 | 0 | 0 |
| Print 2.pdf | 100 | 96 | 0 | 7 | 0 |
| Print.pdf | 50 | 45 | 0 | 19 | 0 |

These are extraction and association counts, not a certification of medical answers or AI-generated explanations. Missing answers and explanations require a configured model. Provider behavior was tested with synthetic responses; no inference credits were consumed during validation.

## Defects repaired

- Initial lecture notes and numbered lists inside side notes could become extra questions. An abbreviated genus in an option could also crash parsing. Explicit questionnaire boundaries, explanation blocks, and source label sequences now preserve the intended items.
- Native PDF object order could interleave columns and associate a highlight with another question. Geometric ordering now retains a mapping to original glyph coordinates for highlights and figures, including restarted numbering.
- Figures between stems and choices, in the next column, on the next page, or after an intervening text-only question could be omitted. Caption and layout evidence now identify the owning question conservatively. An ambiguous association is not broadcast to neighboring questions.
- Scanned option labels could be confused with digits or glyphs, and a missing highlighted line could cause an entire page to be skipped. Repairs require measured margins and adjacent-label evidence. A missing option line is transcribed from its actual local image region; its text is not invented. Highlight keys are appended after complete question blocks so wrapped choices remain intact. Scanned figures use their caption's logical question context.
- Word questionnaire pictures and slide questionnaire pictures were omitted. Embedded Word pictures now follow paragraph/table XML order. PowerPoint extraction uses slide geometry, question blocks, table headers and native pictures. A picture shared by several questions in one text box without a reliable association produces an explicit layout error.
- Some sources use printed E/F/G/H labels. Those labels, original choice order, and explicit multi-answer annotations are preserved rather than silently relabeled or reduced to one answer.

## Explanation contract

Source explanations take precedence. Supported structures include Explanation, Rationale, Why, Reason, Justification, Solution, SIDE NOTES and NOTE blocks; inline annotations; numbered answer-key explanations; and Word/PowerPoint explanation table columns. Prose below an explicit choice answer key is retained as explanation text. Ambiguous unlabeled prose is not guessed into an answer or explanation.

When an explanation is missing, AI fills that gap while copying the supplied question and answer. Explanation-only requests also preserve supplied matching pairs and existing distractors. Figure-dependent explanations use a model that receives the actual image. Returned explanations must contain teaching text rather than simply repeat the answer. Source and AI explanations carry distinct provenance; inference/import notices are stored separately.

Explanations appear after answering or revealing a card in study, practice, reviews, shared sets and live games. Correct practice answers also retain their explanations in the result review. Hidden rationales are absent from the question DOM; live-game question snapshots omit answers and explanation metadata until reveal.

## Completion and recovery

A full question count is not treated as complete while explanations remain pending. Known answers are checkpointed, temporary failures keep the job waiting, and retries request only unfinished work. Card and set IDs remain stable. Filled explanations clear pending flags when a set is continued. Browser checkpoints persist changes even when the number of questions stays the same. Storage, reopening, public sharing and live-game metadata have roundtrip tests.

The system still requires readable source material and an unambiguous question/answer/figure association. Corrupt files, conflicting keys, illegible text and genuinely ambiguous layouts return actionable errors or unresolved-item notices instead of silently importing invented or mismatched content. External provider and host availability govern when pending work can finish, as described in [generation delivery](generation-delivery.md).

## Verification

```text
python -m unittest discover -s backend -p "test_*.py"
node --test tests/*.test.mjs
npm run build
```

Browser harnesses exercise desktop/mobile explanations, original labels and order, matching and written grading, explanation-only continuation, sharing, review, live reveal, cancellation, and restart recovery with real IndexedDB and mocked API responses. Use a local frontend with `NEXT_PUBLIC_API_URL=http://localhost:8000` and run `tests/questionnaire-explanations-browser.mjs`, `tests/questionnaire-browser.mjs`, `tests/generation-recovery-browser.mjs`, and `tests/generation-cancel-browser.mjs`. Their `DAWNSTUDY_PLAYWRIGHT_PATH`, `DAWNSTUDY_BROWSER`, and `DAWNSTUDY_TEST_URL` settings select existing local test tooling.
