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

@click.argument('message', required=True)
@click.command()
def push(message):
  click.echo("Pushing local changes for root...")
  subprocess.run(['git', 'add', '--all'], capture_output=True, check=True)
  subprocess.run(['git', 'commit', '-m', message], capture_output=True, check=True)
  click.echo('Pushed changes for root.')

  if os.path.exists('src/private/.git'):
    click.echo("Pushing local changes for private...")
    subprocess.run(['git', 'add', '--all'], capture_output=True, check=True, cwd='./src/private')
    subprocess.run(['git', 'commit', '-m', message], capture_output=True, check=True, cwd='./src/private')
    click.echo('Pushed changes for private.')

cli.add_command(pull)
cli.add_command(push)

if __name__ == '__main__':
  cli()