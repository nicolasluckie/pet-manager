import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { useTranslation } from 'react-i18next';
import { api, get, patch, photoUrl, put } from '../api/client.js';
import { usePets } from '../api/hooks.js';
import { useErrorMessage } from '../lib/useErrorMessage.js';
import PageHeader from '../components/PageHeader.jsx';
import QueryState from '../components/QueryState.jsx';
import Section from '../components/Section.jsx';
import WikiArticle from './wiki/WikiArticle.jsx';

// Which information may be published. Everything is off until switched on here.
const SHOW_GROUPS = [
  ['species', 'breed', 'sex', 'color', 'born', 'photo'],
  ['neutered', 'microchipped', 'vaccinations'],
  ['biography', 'personality', 'health', 'allergies', 'dietaryNotes', 'favourites', 'gallery'],
  ['homeArea', 'ownerName'],
];
const FAVOURITES = ['toys', 'foods', 'activities', 'sleepingSpots'];

const toLines = (list) => list.join('\n');
const fromLines = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
const wikiKey = (petId) => ['wiki', String(petId)];
const MULTILINE = { multiline: true, minRows: 3 };

/** Configuration page of the public pet wiki: publishing, visible fields, content, gallery. */
export default function Wiki() {
  const { t } = useTranslation();
  const pets = usePets();
  const [selected, setSelected] = useState('');
  return (
    <>
      <PageHeader title={t('wiki.title')} subtitle={t('wiki.subtitle')} />
      <QueryState query={pets}>
        {(list) => {
          if (!list.length) return <Alert severity="info">{t('wiki.noPets')}</Alert>;
          const petId = selected || String(list[0].id);
          return (
            <Stack spacing={2.5}>
              <TextField
                select
                label={t('wiki.pet')}
                value={petId}
                onChange={(e) => setSelected(e.target.value)}
                sx={{ maxWidth: 360 }}
              >
                {list.map((p) => (
                  <MenuItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
              <WikiEditor key={petId} petId={petId} />
            </Stack>
          );
        }}
      </QueryState>
    </>
  );
}

function WikiEditor({ petId }) {
  const query = useQuery({ queryKey: wikiKey(petId), queryFn: () => get(`/pets/${petId}/wiki`) });
  return <QueryState query={query}>{(wiki) => <WikiForm petId={petId} wiki={wiki} />}</QueryState>;
}

function WikiForm({ petId, wiki }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [slug, setSlug] = useState(wiki.slug);
  const [published, setPublished] = useState(wiki.published);
  const [show, setShow] = useState(wiki.show);
  const [content, setContent] = useState(wiki.content);
  const [msg, setMsg] = useState(null);
  const preview = useQuery({
    queryKey: [...wikiKey(petId), 'preview'],
    queryFn: () => get(`/pets/${petId}/wiki/preview`),
  });

  // Gallery changes are saved immediately; the form fields keep their local state.
  const run = async (fn, success) => {
    setMsg(null);
    try {
      queryClient.setQueryData(wikiKey(petId), await fn());
      queryClient.invalidateQueries({ queryKey: [...wikiKey(petId), 'preview'] });
      if (success) setMsg({ severity: 'success', text: success });
    } catch (err) {
      setMsg({ severity: 'error', text: errorMessage(err) });
    }
  };

  const setNested = (group, key, value) =>
    setContent({ ...content, [group]: { ...content[group], [key]: value } });
  const nested = (group, key, lines) => ({
    value: lines ? toLines(content[group][key]) : content[group][key],
    onChange: (e) => setNested(group, key, lines ? fromLines(e.target.value) : e.target.value),
  });
  const flat = (key) => ({
    value: content[key],
    onChange: (e) => setContent({ ...content, [key]: e.target.value }),
  });
  const setRow = (i, changes) =>
    setContent({
      ...content,
      infobox: content.infobox.map((r, j) => (j === i ? { ...r, ...changes } : r)),
    });

  const save = () =>
    run(
      () =>
        put(`/pets/${petId}/wiki`, {
          slug,
          published,
          show,
          content: {
            ...content,
            infobox: content.infobox.filter((r) => r.label.trim() && r.value.trim()),
          },
        }),
      t('common.saved'),
    );

  const upload = (e, target = 'gallery') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('photo', file);
    run(() => api(`/pets/${petId}/wiki/${target}`, { method: 'POST', body }));
  };

  const publicUrl = `${window.location.origin}/wiki/${slug}`;
  const heading = (key) => (
    <Typography variant="subtitle2" component="h3">
      {key}
    </Typography>
  );

  return (
    <Stack spacing={2.5}>
      {msg && <Alert severity={msg.severity}>{msg.text}</Alert>}

      <Section title={t('wiki.publishing')} description={t('wiki.publishingHint')}>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch checked={published} onChange={(e) => setPublished(e.target.checked)} />
            }
            label={t('wiki.published')}
          />
          <TextField
            label={t('wiki.slug')}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            helperText={t('wiki.slugHint')}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">/wiki/</InputAdornment> },
            }}
            sx={{ maxWidth: 420 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={content.titleFromName}
                onChange={(e) => setContent({ ...content, titleFromName: e.target.checked })}
              />
            }
            label={t('wiki.titleFromName')}
          />
          <Typography variant="body2" color="textSecondary" sx={{ mt: -1.5 }}>
            {t('wiki.titleFromNameHint')}
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            {wiki.icon && (
              <Box
                component="img"
                src={photoUrl(wiki.icon)}
                alt={t('wiki.icon.title')}
                sx={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 1 }}
              />
            )}
            <Button component="label" variant="outlined">
              {t('wiki.icon.upload')}
              <input
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => upload(e, 'icon')}
              />
            </Button>
            {wiki.icon && (
              <Button
                onClick={() => run(() => api(`/pets/${petId}/wiki/icon`, { method: 'DELETE' }))}
              >
                {t('wiki.icon.remove')}
              </Button>
            )}
            <Typography variant="body2" color="textSecondary">
              {t('wiki.icon.hint')}
            </Typography>
          </Stack>
          {wiki.published && (
            <Typography variant="body2">
              <Link href={`/wiki/${wiki.slug}`} target="_blank" rel="noreferrer">
                {publicUrl}
              </Link>
            </Typography>
          )}
        </Stack>
      </Section>

      <Section title={t('wiki.visibility')} description={t('wiki.visibilityHint')}>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('wiki.chipNote')}
        </Alert>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={4}>
          {SHOW_GROUPS.map((group) => (
            <FormGroup key={group[0]}>
              {group.map((key) => (
                <FormControlLabel
                  key={key}
                  control={
                    <Checkbox
                      checked={Boolean(show[key])}
                      onChange={(e) => setShow({ ...show, [key]: e.target.checked })}
                    />
                  }
                  label={t(`wiki.show.${key}`)}
                />
              ))}
            </FormGroup>
          ))}
        </Stack>
      </Section>

      <Section title={t('wiki.content')} description={t('wiki.contentHint')}>
        <Stack spacing={2}>
          <TextField label={t('wiki.fields.subtitle')} {...flat('subtitle')} />
          <TextField label={t('wiki.fields.imageCaption')} {...flat('imageCaption')} />

          {heading(t('wiki.fields.infobox'))}
          {content.infobox.map((row, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <TextField
                label={t('wiki.fields.infoboxLabel')}
                value={row.label}
                onChange={(e) => setRow(i, { label: e.target.value })}
              />
              <TextField
                label={t('wiki.fields.infoboxValue')}
                value={row.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
                sx={{ flex: 1 }}
              />
              <IconButton
                aria-label={t('common.delete')}
                onClick={() =>
                  setContent({ ...content, infobox: content.infobox.filter((_, j) => j !== i) })
                }
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
          <Button
            startIcon={<AddIcon />}
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              setContent({ ...content, infobox: [...content.infobox, { label: '', value: '' }] })
            }
          >
            {t('wiki.fields.addRow')}
          </Button>

          {heading(t('wiki.show.biography'))}
          <TextField
            label={t('wiki.fields.intro')}
            helperText={t('wiki.fields.introHint')}
            {...nested('biography', 'content')}
            {...MULTILINE}
          />
          <TextField
            label={t('wiki.fields.earlyLife')}
            {...nested('biography', 'earlyLife')}
            {...MULTILINE}
          />

          {heading(t('wiki.show.personality'))}
          <TextField
            label={t('wiki.fields.description')}
            {...nested('personality', 'content')}
            {...MULTILINE}
          />
          <TextField
            label={t('wiki.fields.traits')}
            helperText={t('wiki.fields.linesHint')}
            {...nested('personality', 'traits', true)}
            {...MULTILINE}
          />

          {heading(t('wiki.show.health'))}
          <TextField
            label={t('wiki.fields.description')}
            {...nested('health', 'content')}
            {...MULTILINE}
          />
          <TextField label={t('wiki.show.allergies')} {...nested('health', 'allergies')} />
          <TextField label={t('wiki.show.dietaryNotes')} {...nested('health', 'dietaryNotes')} />

          {heading(t('wiki.show.favourites'))}
          {FAVOURITES.map((key) => (
            <TextField
              key={key}
              label={t(`wiki.article.${key}`)}
              helperText={t('wiki.fields.linesHint')}
              {...nested('favourites', key, true)}
              multiline
              minRows={2}
            />
          ))}

          {heading(t('wiki.show.homeArea'))}
          <TextField label={t('wiki.article.city')} {...nested('homeArea', 'city')} />
          <TextField label={t('wiki.article.state')} {...nested('homeArea', 'state')} />
          <TextField
            label={t('wiki.fields.areaNotes')}
            helperText={t('wiki.fields.areaHint')}
            {...nested('homeArea', 'notes')}
            {...MULTILINE}
          />

          {heading(t('wiki.article.contact'))}
          <TextField
            label={t('wiki.fields.ownerName')}
            helperText={t('wiki.fields.ownerHint')}
            {...flat('ownerName')}
          />
          <TextField label={t('wiki.fields.contactNote')} {...flat('contactNote')} />

          <Button variant="contained" onClick={save} sx={{ alignSelf: 'flex-start' }}>
            {t('common.save')}
          </Button>
        </Stack>
      </Section>

      <Section title={t('wiki.show.gallery')} description={t('wiki.galleryHint')}>
        <Stack spacing={2}>
          {wiki.gallery.map((img) => (
            <GalleryItem
              key={img.file}
              img={img}
              onCaption={(caption) =>
                run(() => patch(`/pets/${petId}/wiki/gallery/${img.file}`, { caption }))
              }
              onDelete={() =>
                run(() => api(`/pets/${petId}/wiki/gallery/${img.file}`, { method: 'DELETE' }))
              }
            />
          ))}
          <Button component="label" variant="outlined" sx={{ alignSelf: 'flex-start' }}>
            {t('wiki.addImage')}
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={upload}
            />
          </Button>
        </Stack>
      </Section>

      <Section title={t('wiki.preview')} description={t('wiki.previewHint')}>
        <QueryState query={preview}>
          {(article) => (
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'auto',
                '& .wiki': { minHeight: 0 },
                '& .wiki-page': { display: 'flow-root' },
              }}
            >
              <WikiArticle article={article} />
            </Box>
          )}
        </QueryState>
      </Section>
    </Stack>
  );
}

function GalleryItem({ img, onCaption, onDelete }) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState(img.caption);
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box
        component="img"
        src={photoUrl(img.file)}
        alt=""
        sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
      />
      <TextField
        label={t('wiki.fields.caption')}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => caption !== img.caption && onCaption(caption)}
        sx={{ flex: 1 }}
      />
      <IconButton aria-label={t('common.delete')} onClick={onDelete}>
        <DeleteOutlineIcon />
      </IconButton>
    </Stack>
  );
}
