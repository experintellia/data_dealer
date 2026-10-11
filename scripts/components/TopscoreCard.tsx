// Leaderboard card shown in the Topscores ViewTab — a board element like
// `MissionCard`, mounted by `RenderTopscorePerp`
// (scripts/render/RenderTopLevelUI.ts), not a dialog.  Ports
// `views/topscore.html` + `topscore_list.html` + `topscore_rank.html`.
//
// Display names and addrs come from other chat members, so they must
// only ever reach the DOM as JSX text/attributes (escaped) — never via
// dangerouslySetInnerHTML.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { toKSNum } from '../dd-helpers.js';
import type { RankingRow } from '../game/Topscore.js';

export interface TopscoreData {
  type_headlines?: Record<string, string>;
  top?: RankingRow[];
  user_rank?: number;
  user_in_top?: boolean;
}

export interface TopscoreCardProps {
  /** Ranking type: cash / profiles / xp / spent. */
  type: string;
  data: TopscoreData;
}

function LabelIcon({ type }: { type: string }): JSX.Element {
  if (type === 'profiles') return <div class="TopscoreLabelToken" />;
  if (type === 'xp') {
    return (
      <div class="TopscoreLabelStar">
        <span>XP</span>
      </div>
    );
  }
  return <div class="TopscoreLabelCash" />;
}

function ValueIcon({ type }: { type: string }): JSX.Element | string {
  if (type === 'profiles') return <div class="Buy Token" />;
  if (type === 'xp') return '★';
  return <div class="Buy Cash" />;
}

// The slot stays collapsed (CSS) until any avatar loads; a 404 swaps the
// <img> for the `.failed` placeholder sprite.
function Avatar({ src, onLoad }: { src: string; onLoad: () => void }): JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <div class={failed ? 'TopscoreAvatar failed' : 'TopscoreAvatar'}>
      {!failed && <img src={src} alt="" onLoad={onLoad} onError={() => setFailed(true)} />}
    </div>
  );
}

export function TopscoreCard({ type, data }: TopscoreCardProps): JSX.Element {
  const [hasAvatars, setHasAvatars] = useState(false);
  // i18n headlines are "Data Dealer Leaderboard<br />CASH" — split into the
  // two label lines around the icon.
  const [top = '', ...rest] = String(data.type_headlines?.[type] ?? '').split(/<br\s*\/?>/i);
  const rank = data.user_rank ?? 0;
  return (
    <div class="TopscoreInline">
      <div class="TopscoreLabel">
        <div class="TopscoreLabelLine">{top}</div>
        <div class="TopscoreLabelIcon">
          <LabelIcon type={type} />
        </div>
        <div class="TopscoreLabelLine">{rest.join(' ')}</div>
      </div>
      <div class="LoadingSpinner" />
      <div class="TopscoreRank">
        {!data.user_in_top && (
          <div class="TopscoreRankBarWrap">
            <div class="TopscoreRankBarPerc">{toKSNum(rank * 100) + '%'}</div>
            <div class="TopscoreRankBar" style={{ width: rank * 200 + 'px' }} />
          </div>
        )}
      </div>
      <div class={hasAvatars ? 'TopscoreList hasAvatars' : 'TopscoreList'}>
        {(data.top ?? []).map((row, k) => (
          <div
            key={row.addr}
            class={row.self ? 'TopscoreRow user' : 'TopscoreRow'}
            data-testid={
              'dd-leaderboard-row-' + (row.addr || (row.self ? 'self' : 'rank_' + (k + 1)))
            }
          >
            <div class="TopscoreNum">{k + 1}</div>
            {row.avatar && <Avatar src={row.avatar} onLoad={() => setHasAvatars(true)} />}
            <div class="TopscoreDisplayname">{row.display_name}</div>
            <div class="TopscoreValue">
              <ValueIcon type={type} />
              {toKSNum(row.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
