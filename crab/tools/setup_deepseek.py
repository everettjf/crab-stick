#!/usr/bin/env python3
"""Configure the local Pi bridge for DeepSeek without putting keys in source."""
import argparse
import getpass
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def configure(key, model='deepseek-flash'):
    if not key or '\n' in key or '\r' in key:
        raise ValueError('API key is empty or contains a newline')
    folder = ROOT / 'bridge' / 'data' / 'pi'
    folder.mkdir(parents=True, exist_ok=True)
    model_file = folder / 'models.json'
    models = json.loads(model_file.read_text()) if model_file.exists() else {}
    models.setdefault('providers', {})['crab-deepseek'] = {
        'baseUrl': 'https://api.deepseek.com/v1', 'api': 'openai-completions',
        'apiKey': '${DEEPSEEK_API_KEY}',
        'models': [{'id': model, 'name': 'DeepSeek Flash', 'reasoning': False,
                    'input': ['text'], 'contextWindow': 65536, 'maxTokens': 512}],
    }
    model_file.write_text(json.dumps(models, indent=2) + '\n')
    model_file.chmod(0o600)
    env_file = ROOT / 'bridge' / '.env'
    text = env_file.read_text() if env_file.exists() else (ROOT / 'bridge' / '.env.example').read_text()
    updates = {'DEEPSEEK_API_KEY': key, 'PI_PROVIDER': 'crab-deepseek',
               'PI_MODEL': model, 'PI_AGENT_DIR': str(folder)}
    lines, found = text.splitlines(), set()
    for index, line in enumerate(lines):
        name = line.split('=', 1)[0]
        if name in updates:
            lines[index] = name + '=' + updates[name]
            found.add(name)
    lines.extend(name + '=' + value for name, value in updates.items() if name not in found)
    env_file.write_text('\n'.join(lines) + '\n')
    env_file.chmod(0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default='deepseek-flash')
    args = parser.parse_args()
    os.umask(0o077)
    configure(os.environ.get('DEEPSEEK_API_KEY') or getpass.getpass('DeepSeek API key (hidden): '), args.model)
    print('DeepSeek configured locally; API key was not printed. Restart the bridge to apply.')
