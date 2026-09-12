import { useRef, useState } from 'react';
import { audio, eraseSave, exportSaveFile, importSaveFile } from '../../app/runtime';
import type { VfxQuality } from '../../game/vfx/VfxPool';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
import { Moment } from '../archetypes/Moment';
import type { IconName } from '../icons/names';
import { Button } from '../primitives/Button';
import { Choice, Field, Slider, Toggle } from '../primitives/Field';
import { Row } from '../primitives/Row';
import { uiSettings, useUiSettings } from '../state/useUiSettings';
import styles from './SettingsSurface.module.css';

type SectionId = 'audio' | 'display' | 'account';

const SECTIONS: { id: SectionId; label: string; sub: string; icon: IconName }[] = [
  { id: 'audio', label: 'Audio', sub: 'Music, effects and mixing', icon: 'audio' },
  { id: 'display', label: 'Display', sub: 'Focus, effects, readouts', icon: 'statistics' },
  { id: 'account', label: 'Account', sub: 'Your save file', icon: 'character' },
];

const QUALITIES: readonly { id: VfxQuality; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

export function SettingsSurface() {
  const settings = useUiSettings();
  const [section, setSection] = useState<SectionId>('display');

  return (
    <Detail
      list={
        <Ledger
          items={SECTIONS}
          rowKey={(entry) => entry.id}
          header={<span style={{ font: 'inherit' }}>Settings</span>}
          renderRow={(entry) => (
            <Row
              icon={entry.icon}
              iconLive={entry.id === section}
              label={entry.label}
              sub={entry.sub}
              selected={entry.id === section}
              onSelect={() => setSection(entry.id)}
            />
          )}
        />
      }
    >
      {section === 'audio' && <AudioSection settings={settings.audio} />}
      {section === 'display' && <DisplaySection settings={settings.display} />}
      {section === 'account' && <AccountSection />}
    </Detail>
  );
}

function AudioSection({ settings }: { settings: ReturnType<typeof useUiSettings>['audio'] }) {
  /**
   * Only ever set by a real attempt to make a sound. A browser that will not
   * play is worth saying out loud, but guessing at it up front would put a
   * warning across a game that works.
   */
  const [blocked, setBlocked] = useState(false);

  /**
   * A level you cannot hear is a level you cannot set: the settings screen is
   * covering the fight, so there is nothing playing to judge a slider against.
   * Releasing one plays a hit through the same bus at the same mix.
   *
   * The engine answers rather than being asked: whether a device took the
   * sound is only known after a suspended context has been given the chance to
   * resume, which is a promise, not a flag to read on the next line.
   */
  const audition = () => {
    void audio.preview().then((played) => setBlocked(!played));
  };

  return (
    <div className={styles.pane}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Audio</h2>
        <p className={styles.blurb}>
          Evercast synthesises everything it plays - a score that follows the fight, and one voice
          per thing that happens. Nothing is downloaded, and these levels apply as you set them.
        </p>
      </div>

      <div className={styles.fields}>
        <Field label="Master volume" hint="Scales everything below it." disabled={settings.muted}>
          <Slider
            label="Master volume"
            value={settings.master}
            disabled={settings.muted}
            onChange={(master) => uiSettings.setAudio({ master })}
            onCommit={audition}
          />
        </Field>

        <Field
          label="Music"
          hint="The score. It changes with the biome and lifts for a boss."
          disabled={settings.muted}
        >
          <Slider
            label="Music volume"
            value={settings.music}
            disabled={settings.muted}
            onChange={(music) => uiSettings.setAudio({ music })}
          />
        </Field>

        <Field label="Effects" hint="Casts, impacts, and the world." disabled={settings.muted}>
          <Slider
            label="Effects volume"
            value={settings.effects}
            disabled={settings.muted}
            onChange={(effects) => uiSettings.setAudio({ effects })}
            onCommit={audition}
          />
        </Field>

        <Field label="Test sound" hint="Plays one hit at these levels." disabled={settings.muted}>
          <Button onClick={audition} disabled={settings.muted}>
            Play
          </Button>
        </Field>

        <Field label="Mute everything" hint="Silences the mix without losing where it was set.">
          <Toggle
            label="Mute everything"
            checked={settings.muted}
            onChange={(muted) => uiSettings.setAudio({ muted })}
          />
        </Field>
      </div>

      {blocked && (
        <p className={styles.notice}>
          This browser will not play sound for Evercast, so the levels here are set but silent.
          They are still saved; reloading the page tries again.
        </p>
      )}
    </div>
  );
}

function DisplaySection({ settings }: { settings: ReturnType<typeof useUiSettings>['display'] }) {
  return (
    <div className={styles.pane}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Display</h2>
        <p className={styles.blurb}>What the diorama shows you, and how hard it works to show it.</p>
      </div>

      <div className={styles.fields}>
        <Field
          label="Depth of field"
          hint="Holds the road sharp and lets the treeline fall away. Off costs nothing to draw."
        >
          <Slider
            label="Depth of field"
            value={settings.depthOfField}
            format={(value) => (value <= 0.02 ? 'Off' : `${Math.round(value * 100)}%`)}
            onChange={(depthOfField) => uiSettings.setDisplay({ depthOfField })}
          />
        </Field>

        <Field
          label="Effects quality"
          hint="Particle and light budgets. Changing this rebuilds the scene, which takes a moment."
        >
          <Choice
            label="Effects quality"
            value={settings.vfxQuality}
            options={QUALITIES}
            onChange={(vfxQuality) => uiSettings.setDisplay({ vfxQuality })}
          />
        </Field>

        <Field label="Damage numbers" hint="Floating figures over each hit.">
          <Toggle
            label="Damage numbers"
            checked={settings.damageNumbers}
            onChange={(damageNumbers) => uiSettings.setDisplay({ damageNumbers })}
          />
        </Field>

        <Field label="Skip summon animation" hint="Go straight to what a draw pulled.">
          <Toggle
            label="Skip summon animation"
            checked={settings.skipSummonAnimation}
            onChange={(skipSummonAnimation) => uiSettings.setDisplay({ skipSummonAnimation })}
          />
        </Field>
      </div>
    </div>
  );
}

function AccountSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingErase, setConfirmingErase] = useState(false);

  const download = () => {
    const blob = new Blob([exportSaveFile()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `evercast-save-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Read before the size is checked is read regardless, so the check comes
   * first. A save is a few hundred kilobytes; anything past this is a file
   * picked by mistake, and reading a gigabyte of it into a string to find that
   * out costs the player the tab.
   */
  const MAX_SAVE_BYTES = 4_000_000;

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_SAVE_BYTES) {
      setError('That file is far too large to be an Evercast save.');
      return;
    }
    try {
      importSaveFile(await file.text());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file is not an Evercast save.');
    }
  };

  return (
    <div className={styles.pane}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Account</h2>
        <p className={styles.blurb}>
          Evercast has no accounts and no cloud - your run lives in this browser. These are the ways
          to move it or end it.
        </p>
      </div>

      <div className={styles.fields}>
        <Field label="Export save" hint="Downloads a file you can keep or move to another browser.">
          <Button onClick={download}>Download</Button>
        </Field>

        <Field label="Import save" hint="Replaces this run. The file is checked before anything is overwritten.">
          <Button onClick={() => fileInput.current?.click()}>Choose a file</Button>
        </Field>

        <Field label="Erase progress" hint="Starts again from Frontier 1. There is no undo.">
          <Button className={styles.danger} onClick={() => setConfirmingErase(true)}>
            Erase
          </Button>
        </Field>
      </div>

      {/*
        Said in the game rather than only in a document nobody opens. It is a
        short claim because there is little to say: three keys in this browser,
        nothing sent anywhere, and a button above that deletes the lot. The
        long version, with the commands to check it, is docs/PRIVACY.md.
      */}
      <div className={styles.heading}>
        <h3 className={styles.title}>What Evercast keeps</h3>
        <p className={styles.blurb}>
          Three things, all in this browser and none of them about you: your run, your settings,
          and one number that stops offline progress being farmed by moving the clock. There are no
          accounts, no analytics and no third-party scripts - Evercast makes no network request
          except for its own files, and the server it is hosted on refuses any other kind. Erase
          progress above, or clearing site data for this page, removes all three and leaves nothing
          behind.
        </p>
      </div>

      {error !== null && <p className={styles.error}>{error}</p>}

      <input
        ref={fileInput}
        className={styles.hidden}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      {confirmingErase && (
        <Moment
          tone="danger"
          icon="rebirth"
          headline="Erase this run?"
          consequence="Every frontier, point and coin goes. Export it first if you might want it back - there is no undo."
          primary={{ label: 'Erase everything', onClick: eraseSave }}
          secondary={{ label: 'Keep my run', onClick: () => setConfirmingErase(false) }}
          onDismiss={() => setConfirmingErase(false)}
        />
      )}
    </div>
  );
}
