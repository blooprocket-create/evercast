import { useMemo, useState } from 'react';
import { MAX_COMPANION_STARS } from '../../engine/companions/types';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
// prettier-ignore
import { ABILITY_LABEL, ABILITY_NOTE, CLASS_ICON, CLASS_LABEL, RARITY_LABEL, ROW_LABEL, ROW_NOTE, rarityStyle, starText } from '../companions/rarity';
import { NumberCell } from '../format/NumberCell';
// prettier-ignore
import { FILTER_LABEL, ROSTER_FILTERS, ROSTER_SORTS, SORT_LABEL, type RosterFilter, type RosterSort, countFor, viewRoster } from '../companions/roster';
import { Meter } from '../primitives/Meter';
import { Panel } from '../primitives/Panel';
import { Row } from '../primitives/Row';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import styles from './CompanionsSurface.module.css';

export function CompanionsSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<RosterSort>('rarity');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [query, setQuery] = useState('');

  const roster = snapshot.companions;
  // What the list shows; the selection is still resolved against the whole
  // roster, so filtering to Deployed does not blank the pane.
  const shown = useMemo(
    () => viewRoster(roster, { sort, filter, query }),
    [roster, sort, filter, query],
  );
  const selected = roster.find((entry) => entry.definitionId === selectedId) ?? shown[0] ?? roster[0];

  if (roster.length === 0) {
    return (
      <Detail list={<Ledger items={[]} rowKey={() => ''} renderRow={() => null} empty="Nobody yet." />}>
        <span className={styles.eyebrow}>No companions</span>
        <h2 className={styles.name}>You walk this road alone</h2>
        <p className={styles.description}>
          Summon your first companion and it will stand with you in the next fight. Five can fight
          alongside you at once.
        </p>
      </Detail>
    );
  }
  if (!selected) return null;

  return (
    <Detail
      /* Pinned: it was below the fold on every phone and every landscape phone. */
      action={
        <button
          type="button"
          className={styles.ascend}
          disabled={!selected.canAscend}
          onClick={() => run({ type: 'ascend_companion', definitionId: selected.definitionId })}
        >
          {selected.shardsForNextStar === null
            ? 'Nothing left to ascend'
            : selected.canAscend
              ? `Ascend to ${selected.stars + 1} stars`
              : `Needs ${selected.shardsForNextStar - selected.shards} more shards`}
        </button>
      }
      list={
        <Ledger
          items={shown}
          rowKey={(companion) => companion.definitionId}
          empty="Nobody matches that."
          header={
            /*
              Thirty companions, and the screen had no sort, no filter and no
              search - not by rarity, not by class, not by deployed, not by
              "who can I ascend". A collection screen is the one outside the
              fight a player spends the most time on.
            */
            <div className={styles.controls}>
              <div className={styles.controlRow}>
                <span className={styles.eyebrow}>Roster</span>
                <span className={styles.count}>
                  {shown.length === roster.length
                    ? `${roster.length} collected`
                    : `${shown.length} of ${roster.length}`}
                </span>
              </div>
              <div className={styles.controlRow}>
                <input
                  className={styles.search}
                  type="search"
                  value={query}
                  placeholder={`Search ${roster.length} companions`}
                  aria-label="Search companions by name"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <label className={styles.sort}>
                  <span className={styles.sortLabel}>Sort</span>
                  <select
                    className={styles.select}
                    value={sort}
                    onChange={(event) => setSort(event.target.value as RosterSort)}
                  >
                    {ROSTER_SORTS.map((option) => (
                      <option key={option} value={option}>
                        {SORT_LABEL[option]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.chips}>
                {ROSTER_FILTERS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === filter ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={option === filter}
                    onClick={() => setFilter(option)}
                  >
                    {FILTER_LABEL[option]}
                    <span className={styles.chipCount}>{countFor(roster, option)}</span>
                  </button>
                ))}
              </div>
            </div>
          }
          renderRow={(companion) => (
            <span style={rarityStyle(companion.rarity)} className={styles.rowWrap}>
              <Row
                toned
                icon={CLASS_ICON[companion.companionClass]}
                iconLive={companion.canAscend}
                label={companion.name}
                sub={`${RARITY_LABEL[companion.rarity]} · ${CLASS_LABEL[companion.companionClass]}${
                  companion.slot === null ? '' : ` · Slot ${companion.slot + 1}`
                }`}
                value={<span className={styles.stars}>{starText(companion.stars)}</span>}
                selected={companion.definitionId === selected.definitionId}
                onSelect={() => setSelectedId(companion.definitionId)}
              />
            </span>
          )}
        />
      }
    >
      <div style={rarityStyle(selected.rarity)} className={styles.pane}>
        <span className={styles.eyebrow}>
          {RARITY_LABEL[selected.rarity]} · {CLASS_LABEL[selected.companionClass]} ·{' '}
          {selected.kind === 'humanoid' ? 'Humanoid' : 'Creature'}
        </span>
        <h2 className={styles.name}>{selected.name}</h2>
        <p className={styles.description}>{selected.description}</p>

        <div className={styles.facts}>
          <div className={styles.fact}>
            <span>Health</span>
            <NumberCell value={selected.maxHp} />
          </div>
          <div className={styles.fact}>
            <span>Damage</span>
            <NumberCell value={selected.damage} suffix=" / hit" />
          </div>
          <div className={styles.fact}>
            <span>Attacks every</span>
            <NumberCell value={`${selected.attackInterval.toFixed(2)}s`} />
          </div>
          <div className={styles.fact} title={ROW_NOTE[selected.row]}>
            <span>Stands</span>
            <NumberCell value={ROW_LABEL[selected.row]} />
          </div>
          <div
            className={styles.fact}
            title="How hard enemies want to hit this companion. The mage's own threat is 1."
          >
            <span>Threat</span>
            <NumberCell value={selected.threat.toFixed(1)} />
          </div>
        </div>

        <Panel
          title={ABILITY_LABEL[selected.ability.id] ?? selected.ability.id}
          note={selected.ability.cooldown > 0 ? `Every ${selected.ability.cooldown}s` : 'Always on'}
        >
          <p className={styles.description}>{ABILITY_NOTE[selected.ability.id]}</p>
        </Panel>

        <Panel
          title="Ascension"
          note={
            selected.shardsForNextStar === null
              ? 'Fully ascended'
              : `${selected.shards} / ${selected.shardsForNextStar} shards`
          }
        >
          {/*
            The stars, once. The roster already shows them as `★★★☆☆` and this
            panel showed the same fact again as five pip bars - two drawings of
            one number on one screen. The shard count was stated three times
            besides: in this panel's note, in the meter's readout, and on the
            button. The note keeps it; the meter shows the distance rather than
            repeating the figure.
          */}
          <div className={styles.starRow} title={`${selected.stars} of ${MAX_COMPANION_STARS} stars`}>
            {starText(selected.stars, MAX_COMPANION_STARS)}
          </div>
          {selected.shardsForNextStar !== null && (
            <Meter percent={Math.min(100, (selected.shards / selected.shardsForNextStar) * 100)} slim />
          )}
          <p className={styles.hint}>
            Summoning a companion you already have banks shards instead of a second copy.
          </p>
        </Panel>

        <Panel title="Deployment" note={selected.slot === null ? 'On the bench' : `Slot ${selected.slot + 1}`}>
          <p className={styles.hint}>
            {selected.slot === null
              ? `${selected.name} is not deployed. The Party screen decides who stands where.`
              : `${selected.name} is holding slot ${selected.slot + 1}, ${ROW_LABEL[selected.row].toLowerCase()} rank.`}
          </p>
        </Panel>

      </div>
    </Detail>
  );
}
