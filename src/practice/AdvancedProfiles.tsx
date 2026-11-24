import { useState } from "react";
import { z } from "zod";
import { resolveGeneratorConfig } from "../generation";
import { download } from "../platform/download";
import { useTranslation } from "../shared/i18n";
import { Category } from "./ParameterFields";
import type { Config } from "./advancedConfiguration";

export type NamedProfile = { name: string; config: Config };
const exportedProfile = z.strictObject({
  format: z.literal("clefglide-generator-profile"),
  version: z.literal(1),
  name: z.string().min(1).max(60),
  config: z.unknown(),
});

export function AdvancedProfiles({
  config,
  profiles,
  onUse,
  onProfiles,
}: {
  config: Config;
  profiles: readonly NamedProfile[];
  onUse: (candidate: unknown) => boolean;
  onProfiles: (profiles: NamedProfile[]) => void;
}) {
  const tr = useTranslation();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const stem = name.trim();
  const chosen = profiles.find((p) => p.name === selected);
  return (
    <Category
      title="Custom profiles"
      help="Save reusable music settings on this device or transfer them as JSON. Loading a profile stages it for the next exercise."
    >
      <label>
        {tr("Profile name")}
        <input
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={
          !stem ||
          (profiles.length >= 50 && !profiles.some((p) => p.name === stem))
        }
        onClick={() => {
          onProfiles([
            ...profiles.filter((p) => p.name !== stem),
            { name: stem, config },
          ]);
          setSelected(stem);
          setNotice("Profile saved.");
        }}
      >
        {tr(
          profiles.some((p) => p.name === stem)
            ? "Replace saved profile"
            : "Save profile",
        )}
      </button>
      <label>
        {tr("Saved profiles")}
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{tr("Choose a profile")}</option>
          {profiles.map(({ name }) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <div className="profile-actions">
        <button
          type="button"
          disabled={!chosen}
          onClick={() => {
            if (chosen) onUse(chosen.config);
          }}
        >
          {tr("Load profile")}
        </button>
        <button
          type="button"
          disabled={!chosen}
          onClick={() => {
            onProfiles(profiles.filter((p) => p !== chosen));
            setSelected("");
            setNotice("Profile removed.");
          }}
        >
          {tr("Remove profile")}
        </button>
        <button
          type="button"
          onClick={() => {
            const profile = {
              format: "clefglide-generator-profile",
              version: 1,
              name: stem || "Advanced practice",
              config,
            };
            void download(
              "clefglide-profile.json",
              JSON.stringify(profile, undefined, 2),
            ).catch((error) => setNotice(String(error)));
          }}
        >
          {tr("Export parameters")}
        </button>
      </div>
      <label>
        {tr("Import parameters")}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            void file
              .text()
              .then((text) => {
                const json: unknown = JSON.parse(text);
                const profile = exportedProfile.safeParse(json);
                setNotice("");
                if (onUse(profile.success ? profile.data.config : json)) {
                  if (profile.success) setName(profile.data.name);
                  setNotice("Parameters staged.");
                }
              })
              .catch((error) => setNotice(String(error)));
          }}
        />
      </label>
      <button
        className="parameter-reset"
        type="button"
        onClick={() => {
          if (onUse(resolveGeneratorConfig()))
            setNotice("Advanced parameters reset.");
        }}
      >
        {tr("Reset all Advanced parameters")}
      </button>
      {notice && (
        <p className="settings-help" role="status">
          {tr(notice)}
        </p>
      )}
    </Category>
  );
}
