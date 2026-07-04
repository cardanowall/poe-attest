// Action entry point. `run` handles CLI-level failures itself via setFailed; an
// uncaught throw (input validation, binary acquisition, spawn error) fails the
// step here.

import * as core from '@actions/core';

import { run } from './run';
import { errorMessage } from './util';

run().catch((error) => {
  core.setFailed(errorMessage(error));
});
