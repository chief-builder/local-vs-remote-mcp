<script setup lang="ts">
// Renders a ```mermaid block in the browser. Re-renders when the colour theme flips.
import { onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{ graph: string }>();
const { isDark } = useData();
const svg = ref('');
let counter = 0;

async function render() {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark.value ? 'dark' : 'default' });
  const id = `mermaid-${Math.random().toString(36).slice(2)}-${counter++}`;
  svg.value = (await mermaid.render(id, decodeURIComponent(props.graph))).svg;
}

onMounted(render);
watch(isDark, render);
</script>

<template>
  <div class="mermaid-diagram" v-html="svg" />
</template>

<style scoped>
.mermaid-diagram {
  display: flex;
  justify-content: center;
  margin: 1.5rem 0;
  overflow-x: auto;
}
/* Mermaid sizes labels before they enter the page; undo VitePress paragraph styles so text isn't clipped. */
.mermaid-diagram :deep(p) {
  margin: 0;
  line-height: 1.5;
}
</style>
