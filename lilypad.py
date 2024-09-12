import click
import subprocess
import os

@click.group()
def cli():
  pass

@click.command()
def pull():
  click.echo("Pulling latest changes for root...")
  result = subprocess.run(['git', 'pull'], capture_output=True, check=True)
  print(result.stdout.decode('utf-8'))

  if os.path.exists('src/private/.git'):
    click.echo("Pulling latest changes for private...")
    result = subprocess.run(['git', 'pull'], capture_output=True, check=True, cwd='./src/private')
    print(result.stdout.decode('utf-8'))

def push_helper(text, cwd, message):
  click.echo(f"Pushing local changes for {text}...")
  subprocess.run(['git', 'add', '--all'], capture_output=True, cwd=cwd)
  res = subprocess.run(['git', 'commit', '-m', message], capture_output=True, cwd=cwd)
  if res.returncode != 0:
    click.echo('No changes to commit.')
  else:
    subprocess.run(['git', 'push'], capture_output=True, check=True, cwd=cwd)
    click.echo('Pushed changes for root.')

@click.argument('message', required=True)
@click.command()
def push(message):
  push_helper('root', '.', message)
  click.echo('')
  push_helper('private', './src/private', message)

cli.add_command(pull)
cli.add_command(push)

if __name__ == '__main__':
  cli()